import { createServerFn } from "@tanstack/react-start";
import { sql, requireEnv, config } from "./connection";
import { ensureSeed } from "./seed";
import { createPaymentIntent, formatAUD, getStripeConfig } from "./stripe";
import {
  sendBookingConfirmationEmail,
  sendOwnerBookingNotificationEmail,
  sendBookingCancelledByOwnerEmail,
  sendBookingRescheduledEmail,
  sendOwnerRescheduleNotificationEmail,
  sendCreditIssuedEmail,
} from "~/lib/mail";
import {
  calculateFees,
  resolveFeeConfig,
  FEE_CURRENCY,
  CREDIT_EXPIRY_DAYS,
  type FeeConfig,
} from "~/lib/fees";
import {
  resolveSessionUser,
  createOwnerShopBranch,
  type ServiceInput,
  type ShopSchedule,
} from "./auth";

/** Minimum lead time (ms) before a slot start to allow booking. */
export const MIN_LEAD_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface ShopRow {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  photos: string[];
  description: string | null;
  serviceCount?: number;
  /** aggregated service names — used for the home-page search filter */
  services?: string[];
}

export interface ServiceRow {
  id: number;
  shop_id: number;
  slug: string;
  name: string;
  duration_min: number;
  price_cents: number;
  description: string | null;
}

export interface SlotRow {
  id: number;
  shop_id: number;
  starts_at: string; // ISO
  ends_at: string;
  is_open: boolean;
}

export interface BookingRow {
  id: number;
  shop_id: number;
  service_id: number | null;
  slot_id: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  status: string;
  payment_option: string | null;
  paid: boolean;
  payment_intent_id: string | null;
  seen: boolean;
  customer_id: number | null;
  /** set once the confirmation email was successfully sent (reminder status) */
  email_sent_at: string | null;
  /** amount split snapshot at booking time (null for pre-fee bookings) */
  service_cents: number | null;
  fee_cents: number | null;
  total_cents: number | null;
  /** credit applied at checkout (0 = none). PaymentIntent amount = total − credit. */
  credit_applied_cents: number;
  /** when the business owner cancelled the booking (null until cancelled) */
  cancelled_at: string | null;
  created_at: string;
}

export interface BookingView extends BookingRow {
  shopName: string;
  shopSlug: string;
  serviceName: string | null;
  durationMin: number | null;
  priceCents: number | null;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
}

const asShop = (r: Record<string, any>): ShopRow => ({
  id: Number(r.id),
  slug: r.slug,
  name: r.name,
  address: r.address,
  photos: Array.isArray(r.photos) ? r.photos : [],
  description: r.description,
});

function rowToBookingView(r: Record<string, any>): BookingView {
  return {
    id: Number(r.id),
    shop_id: Number(r.shop_id),
    service_id: r.service_id == null ? null : Number(r.service_id),
    slot_id: r.slot_id == null ? null : Number(r.slot_id),
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    customer_phone: r.customer_phone,
    status: r.status,
    payment_option: r.payment_option,
    paid: Boolean(r.paid),
    payment_intent_id: r.payment_intent_id,
    seen: Boolean(r.seen),
    customer_id: r.customer_id == null ? null : Number(r.customer_id),
    service_cents: r.service_cents == null ? null : Number(r.service_cents),
    fee_cents: r.fee_cents == null ? null : Number(r.fee_cents),
    total_cents: r.total_cents == null ? null : Number(r.total_cents),
    credit_applied_cents: r.credit_applied_cents == null ? 0 : Number(r.credit_applied_cents),
    cancelled_at:
      r.cancelled_at == null
        ? null
        : r.cancelled_at instanceof Date
          ? r.cancelled_at.toISOString()
          : r.cancelled_at,
    email_sent_at:
      r.email_sent_at == null ? null : r.email_sent_at instanceof Date
        ? r.email_sent_at.toISOString()
        : r.email_sent_at,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    shopName: r.shop_name,
    shopSlug: r.shop_slug,
    serviceName: r.service_name,
    durationMin: r.duration_min == null ? null : Number(r.duration_min),
    priceCents: r.price_cents == null ? null : Number(r.price_cents),
    slotStartsAt: r.slot_starts ? new Date(r.slot_starts).toISOString() : null,
    slotEndsAt: r.slot_ends ? new Date(r.slot_ends).toISOString() : null,
  };
}

/** Directory home: all shops with a service-count preview. */
export const listShops = createServerFn().handler(async (): Promise<ShopRow[]> => {
  await ensureSeed();
  const db = sql();
  const rows = await db`
    SELECT s.*,
      (SELECT count(*) FROM arvo.services sv WHERE sv.shop_id = s.id)::int AS service_count,
      COALESCE((SELECT array_agg(sv.name) FROM arvo.services sv WHERE sv.shop_id = s.id), ARRAY[]::text[]) AS service_names
    FROM arvo.shops s
    ORDER BY s.name
  `;
  return rows.map((r: Record<string, any>) => ({
    ...asShop(r),
    serviceCount: Number(r.service_count),
    services: Array.isArray(r.service_names) ? (r.service_names as string[]) : [],
  }));
});

/** A single shop + its full service menu + photos. */
export const getShop = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: slug }): Promise<{ shop: ShopRow; services: ServiceRow[] } | null> => {
    await ensureSeed();
    const db = sql();
    const shops = await db`SELECT * FROM arvo.shops WHERE slug = ${slug}`;
    if (shops.length === 0) return null;
    const shop = asShop(shops[0] as Record<string, any>);
    const services = await db`
      SELECT * FROM arvo.services WHERE shop_id = ${shop.id} ORDER BY price_cents ASC
    `;
    return {
      shop,
      services: services.map((r: Record<string, any>) => ({
        id: Number(r.id),
        shop_id: Number(r.shop_id),
        slug: r.slug,
        name: r.name,
        duration_min: Number(r.duration_min),
        price_cents: Number(r.price_cents),
        description: r.description,
      })),
    };
  });

/**
 * Bookable slots for a shop: open, future by at least the 3-hour window, and
 * not already taken by a non-cancelled booking. Grouping is done client-side.
 */
export const getAvailableSlots = createServerFn()
  .validator((d: { shopSlug: string }) => d)
  .handler(async ({ data }): Promise<SlotRow[]> => {
    await ensureSeed();
    const db = sql();
    const shops = await db`SELECT id FROM arvo.shops WHERE slug = ${data.shopSlug}`;
    if (shops.length === 0) return [];
    const shopId = Number((shops[0] as { id: number }).id);
    const cutoff = new Date(Date.now() + MIN_LEAD_MS);
    const rows = await db`
      SELECT id, shop_id, starts_at, ends_at, is_open
      FROM arvo.slots
      WHERE shop_id = ${shopId}
        AND is_open = true
        AND starts_at > ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM arvo.bookings b WHERE b.slot_id = arvo.slots.id AND b.status NOT IN ('cancelled', 'cancellation_pending')
        )
      ORDER BY starts_at ASC
    `;
    return rows.map((r: Record<string, any>) => ({
      id: Number(r.id),
      shop_id: Number(r.shop_id),
      starts_at: new Date(r.starts_at).toISOString(),
      ends_at: new Date(r.ends_at).toISOString(),
      is_open: Boolean(r.is_open),
    }));
  });

export interface GridSlot extends SlotRow {
  /** true when the slot can be booked right now (open + future by >=3h + free). */
  available: boolean;
}

/**
 * Full slot grid for the booking page: EVERY slot from now out to the seeded
 * horizon, each with a server-computed `available` flag (is_open AND at least
 * the 3-hour lead AND not taken by a non-cancelled booking). The UI renders
 * unavailable (booked / too-soon / closed) slots as visibly disabled. The
 * `available` computation mirrors the free-slots query in getAvailableSlots, so
 * the server-side truth that excludes booked + past-too-soon slots is unchanged.
 */
export const getSlotGrid = createServerFn()
  .validator((d: { shopSlug: string }) => d)
  .handler(async ({ data }): Promise<GridSlot[]> => {
    await ensureSeed();
    const db = sql();
    const shops = await db`SELECT id FROM arvo.shops WHERE slug = ${data.shopSlug}`;
    if (shops.length === 0) return [];
    const shopId = Number((shops[0] as { id: number }).id);
    const cutoff = new Date(Date.now() + MIN_LEAD_MS);
    const rows = await db`
      SELECT id, shop_id, starts_at, ends_at, is_open,
        (starts_at > ${cutoff} AND is_open = true AND NOT EXISTS (
          SELECT 1 FROM arvo.bookings b WHERE b.slot_id = arvo.slots.id AND b.status NOT IN ('cancelled', 'cancellation_pending')
        )) AS available
      FROM arvo.slots
      WHERE shop_id = ${shopId}
        AND ends_at >= now()
      ORDER BY starts_at ASC
    `;
    return rows.map((r: Record<string, any>) => ({
      id: Number(r.id),
      shop_id: Number(r.shop_id),
      starts_at: new Date(r.starts_at).toISOString(),
      ends_at: new Date(r.ends_at).toISOString(),
      is_open: Boolean(r.is_open),
      available: Boolean(r.available),
    }));
  });

export type PaymentOption = "pay_online";

export interface FeeSchedule {
  /** Stripe rate percent, e.g. 2.9 (non-AU cards) or 1.75 (AU domestic). */
  percent: number;
  /** Flat fee in AUD cents, e.g. 30. */
  fixedCents: number;
  currency: string;
  /** Human summary shown in the checkout UI, e.g. "2.9% + A$0.30". */
  rateLabel: string;
}

/**
 * The fee schedule the server applies to every online payment. Reads env
 * overrides (STRIPE_FEE_PERCENT / STRIPE_FEE_FIXED_CENTS); falls back to the
 * documented Stripe defaults (2.9% + 30¢ AUD). Exposed as a server fn so the
 * checkout UI can show the exact breakdown BEFORE the booking is created, with
 * no drift between display and the amount actually carded.
 */
export const getFeeSchedule = createServerFn()
  .handler(async (): Promise<FeeSchedule> => {
    const cfg: FeeConfig = resolveFeeConfig(process.env);
    return {
      percent: cfg.percent,
      fixedCents: cfg.fixedCents,
      currency: FEE_CURRENCY,
      rateLabel: `${cfg.percent}% + ${formatAUD(cfg.fixedCents)}`,
    };
  });

export interface CreateBookingInput {
  shopSlug: string;
  serviceSlug: string;
  slotId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerId?: number | null;
  /**
   * Opt-in credit application (checkbox, unchecked by default). When true, the
   * customer's active credit balance for this email reduces the amount charged.
   */
  applyCredit?: boolean;
}

export interface CreateBookingResult {
  ok: boolean;
  error?: string;
  booking?: BookingView;
  payment?: {
    mode: PaymentOption;
    /** service price in cents — NOT what is carded */
    serviceCents: number;
    /** Stripe fee surcharge in cents */
    feeCents: number;
    /** full total in cents (service + fee) — the booking's value */
    totalCents: number;
    /** credit applied at checkout (0 when none / unchecked) */
    creditAppliedCents: number;
    /** amount actually carded in cents = totalCents − creditAppliedCents (0 when fully covered) */
    chargedCents: number;
    /** formatted charged amount, e.g. "A$26.03" (what the customer pays now) */
    amountDisplay: string;
    /** formatted service price, e.g. "A$25.00" */
    serviceDisplay: string;
    /** formatted fee, e.g. "A$1.03" */
    feeDisplay: string;
    /** formatted credit applied, e.g. "A$10.00" */
    creditDisplay: string;
    /** fee rate summary, e.g. "2.9% + A$0.30" */
    rateLabel: string;
    hasKeys: boolean;
    /**
     * true when active credit covered the full total — nothing to card, no
     * PaymentIntent was created, and the booking is already confirmed/paid.
     * The UI shows a success panel instead of the card form.
     */
    paidInFull: boolean;
    /** present only when hasKeys (real Stripe Payment Element) */
    clientSecret?: string;
    publishableKey?: string;
  };
}

export const createBooking = createServerFn()
  .validator((d: CreateBookingInput) => d)
  .handler(async ({ data }): Promise<CreateBookingResult> => {
    try {
      requireEnv("databaseUrl");
      await ensureSeed();
      const db = sql();

      // Resolve shop + service.
      const shops = await db`SELECT * FROM arvo.shops WHERE slug = ${data.shopSlug}`;
      if (shops.length === 0) return { ok: false, error: "Mobile service not found." };
      const shop = shops[0] as Record<string, any>;
      const shopId = Number(shop.id);

      const services = await db`
        SELECT * FROM arvo.services WHERE slug = ${data.serviceSlug} AND shop_id = ${shopId}
      `;
      if (services.length === 0) return { ok: false, error: "Service not found." };
      const service = services[0] as Record<string, any>;
      const serviceId = Number(service.id);
      const priceCents = Number(service.price_cents);

      // Resolve + validate slot (open, within 3h window, not booked).
      const slotId = Number(data.slotId);
      const slots = await db`
        SELECT * FROM arvo.slots WHERE id = ${slotId} AND shop_id = ${shopId}
      `;
      if (slots.length === 0) return { ok: false, error: "Slot not available." };
      const slot = slots[0] as Record<string, any>;
      const startsAt = new Date(slot.starts_at);
      if (!slot.is_open) return { ok: false, error: "This slot is closed." };
      if (startsAt.getTime() < Date.now() + MIN_LEAD_MS) {
        return { ok: false, error: "This slot is too soon — bookings close 3 hours before the start time." };
      }
      const taken = await db`
        SELECT 1 FROM arvo.bookings WHERE slot_id = ${slotId} AND status NOT IN ('cancelled', 'cancellation_pending')
      `;
      if (taken.length > 0) return { ok: false, error: "Sorry, that slot was just taken. Please choose another." };

      // Every booking pays now: create the PaymentIntent up front when real
      // Stripe keys are configured (otherwise the UI runs in demo mode).
      // The customer pays service price + Stripe fee surcharge (2.9% + 30¢ AUD
      // by default — see src/lib/fees.ts), MINUS any opt-in credit applied, so
      // the intent amount is the amount remaining after credit.
      const paymentOption: PaymentOption = "pay_online";
      let paymentIntentId: string | null = null;
      const stripe = getStripeConfig();
      const feeCfg: FeeConfig = resolveFeeConfig(process.env);
      const { feeCents, totalCents } = calculateFees(priceCents, feeCfg);

      // Opt-in credit application (checkbox, unchecked by default). Even if a
      // caller forces applyCredit=true, only verified active credits for THIS
      // email reduce the charge.
      let creditAppliedCents = 0;
      if (data.applyCredit) {
        const balance = await getActiveCreditBalanceForEmail(data.customerEmail);
        creditAppliedCents = Math.min(balance, totalCents);
      }
      const chargedCents = totalCents - creditAppliedCents;
      const paidInFull = creditAppliedCents > 0 && chargedCents === 0;

      if (stripe.hasKeys && !paidInFull) {
        // Stripe rejects 0-value intents, so a fully-credit-covered booking
        // never touches Stripe.
        const pi = await createPaymentIntent({
          amountCents: chargedCents, // service + fee − credit — this is what gets carded
          currency: "aud",
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          shopName: String(shop.name),
          serviceName: String(service.name),
        });
        paymentIntentId = pi.id;
      }

      // Fully covered by credit → the booking is confirmed/paid immediately
      // (the money already moved when the credit was issued).
      const status = paidInFull ? "confirmed" : "awaiting_payment";
      const paid = paidInFull;

      const inserted = await db`
        INSERT INTO arvo.bookings
          (shop_id, service_id, slot_id, customer_id, customer_name, customer_email, customer_phone, status, payment_option, paid, payment_intent_id, service_cents, fee_cents, total_cents, credit_applied_cents)
        VALUES
          (${shopId}, ${serviceId}, ${slotId}, ${data.customerId ?? null}, ${data.customerName}, ${data.customerEmail}, ${data.customerPhone || null}, ${status}, ${paymentOption}, ${paid}, ${paymentIntentId}, ${priceCents}, ${feeCents}, ${totalCents}, ${creditAppliedCents})
        RETURNING *
      `;
      const booking = rowToBookingView(inserted[0] as Record<string, any>);

      // Payment ledger row — 'pending' until the card charge succeeds, flipped
      // to 'paid' by markBookingPaid. For a fully-credit booking the funds are
      // already accounted for, so the row is 'paid' from the start with
      // total_cents = net cash moved (0 after credit).
      const txStatus = paidInFull ? "paid" : "pending";
      const txInserted = await db`
        INSERT INTO arvo.transactions
          (booking_id, shop_id, service_id, customer_id, customer_name, customer_email, service_cents, fee_cents, total_cents, credit_applied_cents, currency, status, payment_method, payment_intent_id, paid_at)
        VALUES
          (${booking.id}, ${shopId}, ${serviceId}, ${data.customerId ?? null}, ${data.customerName}, ${data.customerEmail}, ${priceCents}, ${feeCents}, ${chargedCents}, ${creditAppliedCents}, 'aud', ${txStatus}, ${paidInFull ? "credit" : "card"}, ${paymentIntentId}, ${paidInFull ? new Date() : null})
        RETURNING id
      `;
      if (txInserted.length === 0) {
        console.error(`[arvo:tx] transaction row not created for booking ${booking.id}`);
      }

      // Mark the consumed credits used (oldest-expiring first) once the booking
      // row exists so the applied_to_booking_id link is always valid. Wrapped in
      // try/catch: a failure here is logged loudly but never fails the booking
      // (the customer already paid the reduced amount).
      if (creditAppliedCents > 0) {
        try {
          await consumeCredits(
            data.customerEmail,
            creditAppliedCents,
            booking.id,
          );
        } catch (e) {
          console.error(
            `[arvo:credits] failed to mark credits used for booking ${booking.id}:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      // Fully-credit bookings skip the card form — send the confirmation emails
      // now (bounded, non-blocking), matching what markBookingPaid does for
      // card-paid bookings.
      if (paidInFull) {
        await sendBookingConfirmationEmailForBooking(booking.id);
      }

      let clientSecret: string | undefined;
      if (paymentIntentId && stripe.hasKeys) {
        // We only have the intent id here; refetch client_secret via the API
        // (createPaymentIntent returned it, but we persisted only the id — the
        // client needs the client_secret, so retrieve it now).
        const piRes = await retrieveClientSecret(paymentIntentId);
        clientSecret = piRes;
      }

      return {
        ok: true,
        booking,
        payment: {
          mode: paymentOption,
          serviceCents: priceCents,
          feeCents,
          totalCents,
          creditAppliedCents,
          chargedCents,
          amountDisplay: formatAUD(chargedCents),
          serviceDisplay: formatAUD(priceCents),
          feeDisplay: formatAUD(feeCents),
          creditDisplay: formatAUD(creditAppliedCents),
          rateLabel: `${feeCfg.percent}% + ${formatAUD(feeCfg.fixedCents)}`,
          hasKeys: stripe.hasKeys && !paidInFull,
          paidInFull,
          ...(clientSecret && stripe.hasKeys && !paidInFull
            ? { clientSecret, publishableKey: stripe.publishableKey }
            : {}),
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

async function retrieveClientSecret(paymentIntentId: string): Promise<string | undefined> {
  const cfg = getStripeConfig();
  if (!cfg.hasKeys) return undefined;
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  const data = (await res.json()) as { client_secret?: string };
  return data.client_secret;
}

/** Mark an awaiting-payment booking confirmed once the card charge succeeds. */
export const markBookingPaid = createServerFn()
  .validator((d: number) => d)
  .handler(async ({ data: id }) => {
    const db = sql();
    const updated = await db`
      UPDATE arvo.bookings
      SET status = 'confirmed', paid = true
      WHERE id = ${id} AND status = 'awaiting_payment'
      RETURNING id
    `;
    // Payment confirmed → update the payment ledger (pending → paid).
    if (updated.length > 0) {
      await db`
        UPDATE arvo.transactions
        SET status = 'paid', paid_at = now()
        WHERE booking_id = ${id} AND status = 'pending'
      `;
    }
    // Payment confirmed → send the confirmation email (bounded, non-blocking).
    // Booking success is never dependent on mail: on failure we only log.
    if (updated.length > 0) {
      await sendBookingConfirmationEmailForBooking(id);
    }
    return true;
  });

/**
 * Build + send the post-payment emails for a confirmed booking:
 *   1. customer receipt (booking confirmed + amount breakdown), and
 *   2. owner notification (new paid booking with details + breakdown).
 * Then stamp `email_sent_at` on success. Never throws — failures are logged and
 * the booking is unaffected.
 */
async function sendBookingConfirmationEmailForBooking(bookingId: number): Promise<void> {
  try {
    const db = sql();
    const rows = await db`
      SELECT b.id, b.customer_email, b.customer_name, b.customer_phone,
             b.service_cents, b.fee_cents, b.total_cents, b.credit_applied_cents, b.shop_id,
             s.name AS shop_name, s.address AS shop_address,
             sv.name AS service_name,
             sl.starts_at AS slot_starts
      FROM arvo.bookings b
      JOIN arvo.shops s ON s.id = b.shop_id
      LEFT JOIN arvo.services sv ON sv.id = b.service_id
      LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
      WHERE b.id = ${bookingId}
    `;
    const r = rows[0] as Record<string, any> | undefined;
    if (!r || !r.customer_email) return;

    const when = new Date(r.slot_starts).toLocaleString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    });
    const reference = `ARVO-${String(Number(r.id)).padStart(4, "0")}`;
    // Amounts snapshot at booking time (null for bookings created before fees).
    const amounts =
      r.total_cents != null
        ? {
            serviceCents: Number(r.service_cents ?? 0),
            feeCents: Number(r.fee_cents ?? 0),
            totalCents: Number(r.total_cents),
            creditAppliedCents: Number(r.credit_applied_cents ?? 0),
          }
        : undefined;

    // 1. Customer receipt with the fee breakdown.
    await sendBookingConfirmationEmail({
      to: r.customer_email,
      reference,
      shopName: r.shop_name,
      serviceName: r.service_name || "Car detailing",
      when,
      address: r.shop_address || null,
      amounts,
    });

    // 2. Owner notification. Seeded demo shops may have no owner row on file —
    //    in that case skip silently (the booking still lands on the dashboard).
    const owners = await db`
      SELECT email, name FROM arvo.owners WHERE shop_id = ${Number(r.shop_id)} ORDER BY id ASC
    `;
    for (const ownerRow of owners as Record<string, any>[]) {
      const ownerEmail = ownerRow.email;
      if (!ownerEmail) continue;
      try {
        await sendOwnerBookingNotificationEmail({
          to: ownerEmail,
          ownerName: ownerRow.name || null,
          reference,
          shopName: r.shop_name,
          serviceName: r.service_name || "Car detailing",
          when,
          address: r.shop_address || null,
          customerName: r.customer_name,
          customerPhone: r.customer_phone || null,
          amounts,
        });
      } catch (e) {
        console.error(
          `[arvo:mail] owner notification failed for booking ${bookingId} -> ${ownerEmail}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    await db`UPDATE arvo.bookings SET email_sent_at = now() WHERE id = ${bookingId}`;
  } catch (e) {
    console.error(
      `[arvo:mail] confirmation email failed for booking ${bookingId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Fetch one booking (for the confirmation page). */
export const getBooking = createServerFn()
  .validator((d: number) => d)
  .handler(async ({ data: id }): Promise<BookingView | null> => {
    const db = sql();
    const rows = await db`
      SELECT b.*, s.name AS shop_name, s.slug AS shop_slug,
             sv.name AS service_name, sv.duration_min, sv.price_cents,
             sl.starts_at AS slot_starts, sl.ends_at AS slot_ends
      FROM arvo.bookings b
      JOIN arvo.shops s ON s.id = b.shop_id
      LEFT JOIN arvo.services sv ON sv.id = b.service_id
      LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
      WHERE b.id = ${id}
    `;
    return rows.length ? rowToBookingView(rows[0] as Record<string, any>) : null;
  });

export interface DashboardData {
  shop: ShopRow | null;
  bookings: BookingView[];
  unread: number;
}

/** Load the dashboard data for a shop (bookings + unread count). */
async function loadDashboard(shopId: number): Promise<DashboardData> {
  const db = sql();
  const shops = await db`SELECT * FROM arvo.shops WHERE id = ${shopId}`;
  if (shops.length === 0) return { shop: null, bookings: [], unread: 0 };
  const shop = asShop(shops[0] as Record<string, any>);
  const rows = await db`
    SELECT b.*, s.name AS shop_name, s.slug AS shop_slug,
           sv.name AS service_name, sv.duration_min, sv.price_cents,
           sl.starts_at AS slot_starts, sl.ends_at AS slot_ends
    FROM arvo.bookings b
    JOIN arvo.shops s ON s.id = b.shop_id
    LEFT JOIN arvo.services sv ON sv.id = b.service_id
    LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
    WHERE b.shop_id = ${shop.id}
    ORDER BY COALESCE(sl.starts_at, b.created_at) DESC
  `;
  const bookings = rows.map((r: Record<string, any>) => rowToBookingView(r));
  // Notifications count: active bookings only — cancelled and
  // cancellation_pending (owner cancelled, customer choosing) are not "new".
  const unread = bookings.filter(
    (b) => !["cancelled", "cancellation_pending"].includes(b.status) && !b.seen,
  ).length;
  return { shop, bookings, unread };
}

/** Shop dashboard data (maintained for internal reuse; owner-gated via getOwnerDashboard). */
export const getDashboard = createServerFn()
  .validator((d: string) => d)
  .handler(
    async ({ data: slug }): Promise<DashboardData> => {
      await ensureSeed();
      const db = sql();
      const shops = await db`SELECT id FROM arvo.shops WHERE slug = ${slug}`;
      if (shops.length === 0) return { shop: null, bookings: [], unread: 0 };
      return loadDashboard(Number((shops[0] as { id: number }).id));
    },
  );

export type OwnerDashAccess = "guest" | "denied" | "ok";

/**
 * Owner-gated shop dashboard. Resolves the session server-side and only returns
 * the shop's bookings when the caller is an owner whose shop_id matches the
 * requested slug. `guest` = no/invalid session, `denied` = non-owner session or
 * an owner who does not own this shop, `ok` = authorized (with data).
 */
export const getOwnerDashboard = createServerFn()
  .validator((d: { token: string; slug: string }) => d)
  .handler(
    async ({ data }): Promise<{ access: OwnerDashAccess; dash?: DashboardData; shopId?: number }> => {
      const user = await resolveSessionUser(data.token);
      if (!user) return { access: "guest" };
      if (user.role !== "owner") return { access: "denied" };
      const db = sql();
      const shops = await db`SELECT id FROM arvo.shops WHERE slug = ${data.slug}`;
      if (shops.length === 0) return { access: "ok", dash: { shop: null, bookings: [], unread: 0 } };
      const shopId = Number((shops[0] as { id: number }).id);
      if (user.shopId == null || user.shopId !== shopId) return { access: "denied", shopId };
      const dash = await loadDashboard(shopId);
      return { access: "ok", dash, shopId };
    },
  );

/**
 * The shop owned by a logged-in owner (if any). Returns null for guests,
 * customers, or owners who have not set up a shop yet. Used to route an owner
 * to their dashboard after logging in.
 */
export const getOwnerShop = createServerFn()
  .validator((d: string) => d)
  .handler(
    async ({
      data: token,
    }): Promise<{ id: number; slug: string; name: string } | null> => {
      const user = await resolveSessionUser(token);
      if (!user || user.role !== "owner" || user.shopId == null) return null;
      const db = sql();
      const rows = await db`SELECT id, slug, name FROM arvo.shops WHERE id = ${user.shopId}`;
      if (rows.length === 0) return null;
      const r = rows[0] as { id: number; slug: string; name: string };
      return { id: Number(r.id), slug: r.slug, name: r.name };
    },
  );

/**
 * Create a shop for an already-registered owner (the "add another shop" /
 * "finish setup" path — registration itself always creates the first shop).
 * Links the new shop to the owner's account and makes it bookable immediately.
 */
export const createShopForOwner = createServerFn()
  .validator(
    (d: {
      token: string;
      shop: {
        name: string;
        address: string;
        description?: string;
        photos?: string[];
        schedule?: ShopSchedule;
      };
      services?: ServiceInput[];
    }) => d,
  )
  .handler(
    async ({ data }): Promise<{ ok: boolean; error?: string; slug?: string; shopId?: number }> => {
      const user = await resolveSessionUser(data.token);
      if (!user || user.role !== "owner") {
        return { ok: false, error: "You must be signed in as a mobile business." };
      }
      if (!data.shop.name || !data.shop.address) {
        return { ok: false, error: "Business name and address are required." };
      }
      const db = sql();
      const branch = await createOwnerShopBranch(db, {
        name: data.shop.name,
        address: data.shop.address,
        description: data.shop.description,
        photos: data.shop.photos,
        schedule: data.shop.schedule,
        services: data.services,
      });
      await db`UPDATE arvo.owners SET shop_id = ${branch.id} WHERE id = ${user.id}`;
      return { ok: true, slug: branch.slug, shopId: branch.id };
    },
  );


/** Mark bookings as read (clear the dashboard notification). */
export const markBookingsSeen = createServerFn()
  .validator((d: number[]) => d)
  .handler(async ({ data: ids }) => {
    if (!ids.length) return true;
    const db = sql();
    // chunk to stay within param limits
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      for (const id of chunk) {
        await db`UPDATE arvo.bookings SET seen = true WHERE id = ${id}`;
      }
    }
    return true;
  });

/**
 * "My Bookings" dashboard: all bookings for the logged-in customer (resolved
 * server-side from the opaque session token, so a caller can only ever see
 * their own bookings). Returns an empty list for guests / non-customers.
 */
export const getMyBookings = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: token }): Promise<BookingView[]> => {
    const user = await resolveSessionUser(token);
    if (!user || user.role !== "customer") return [];
    const db = sql();
    const rows = await db`
      SELECT b.*, s.name AS shop_name, s.slug AS shop_slug,
             sv.name AS service_name, sv.duration_min, sv.price_cents,
             sl.starts_at AS slot_starts, sl.ends_at AS slot_ends
      FROM arvo.bookings b
      JOIN arvo.shops s ON s.id = b.shop_id
      LEFT JOIN arvo.services sv ON sv.id = b.service_id
      LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
      WHERE b.customer_id = ${user.id}
      ORDER BY COALESCE(sl.starts_at, b.created_at) DESC
    `;
    return rows.map((r: Record<string, any>) => rowToBookingView(r));
  });

/* ═══════════════════════════════════════════════════════════════
 * Phase B part 2 — owner-only cancellations + customer credit
 *
 * Rules (enforced server-side):
 *   - A customer can NEVER cancel a booking on their own. There is NO
 *     cancellation endpoint callable by customers; the only cancellation
 *     entry point is `cancelBookingByOwner`, which requires an owner session
 *     for the booking's shop.
 *   - When the owner cancels, the booking goes to 'cancellation_pending' and
 *     the customer is emailed exactly two options: RESCHEDULE (new slot, same
 *     booking record + payment) or CANCEL FOR CREDIT (no card refund — the
 *     amount paid becomes a 90-day credit balance).
 * ═══════════════════════════════════════════════════════════════ */

export type CreditStatus = "active" | "used" | "expired";

export interface CreditRow {
  id: number;
  customer_email: string;
  customer_id: number | null;
  amount_cents: number;
  currency: string;
  expires_at: string;
  status: CreditStatus;
  source_booking_id: number;
  applied_to_booking_id: number | null;
  used_at: string | null;
  created_at: string;
}

export interface CreditView extends CreditRow {
  /**
   * 'active' credits past their expiry are shown (and treated) as 'expired' —
   * they are forfeited and never usable at checkout.
   */
  effectiveStatus: CreditStatus;
}

function rowToCredit(r: Record<string, any>): CreditRow {
  return {
    id: Number(r.id),
    customer_email: r.customer_email,
    customer_id: r.customer_id == null ? null : Number(r.customer_id),
    amount_cents: Number(r.amount_cents),
    currency: r.currency,
    expires_at: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
    status: r.status as CreditStatus,
    source_booking_id: Number(r.source_booking_id),
    applied_to_booking_id:
      r.applied_to_booking_id == null ? null : Number(r.applied_to_booking_id),
    used_at:
      r.used_at == null ? null : r.used_at instanceof Date ? r.used_at.toISOString() : r.used_at,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

/** Random single-use token (hex) used in the customer's cancellation email links. */
async function newSingleUseToken(): Promise<string> {
  const crypto = await import("node:crypto");
  return crypto.randomBytes(32).toString("hex");
}

/** Sum of usable (active + unexpired) credits for an email, in AUD cents. */
async function getActiveCreditBalanceForEmail(email: string): Promise<number> {
  const db = sql();
  const rows = await db`
    SELECT COALESCE(SUM(amount_cents), 0)::int AS total
    FROM arvo.credits
    WHERE customer_email = ${email.trim().toLowerCase()}
      AND status = 'active'
      AND expires_at > now()
  `;
  return Number((rows[0] as { total: number }).total ?? 0);
}

/**
 * Mark up to `amountCents` of the customer's active credits as used against a
 * booking. Consumes soonest-expiring credits first. A partially-consumed credit
 * keeps its leftover balance active and gets a separate 'used' row for the
 * applied portion, so the ledger always balances exactly (partial application
 * across a balance is fully supported).
 */
async function consumeCredits(
  email: string,
  amountCents: number,
  bookingId: number,
): Promise<void> {
  if (amountCents <= 0) return;
  const db = sql();
  const rows = await db`
    SELECT id, customer_email, customer_id, amount_cents, currency, expires_at, source_booking_id
    FROM arvo.credits
    WHERE customer_email = ${email.trim().toLowerCase()}
      AND status = 'active'
      AND expires_at > now()
    ORDER BY expires_at ASC, id ASC
  `;
  let remaining = amountCents;
  for (const r of rows as Record<string, any>[]) {
    if (remaining <= 0) break;
    const id = Number(r.id);
    const avail = Number(r.amount_cents);
    const take = Math.min(avail, remaining);
    if (take >= avail) {
      await db`
        UPDATE arvo.credits
        SET status = 'used', used_at = now(), applied_to_booking_id = ${bookingId}
        WHERE id = ${id} AND status = 'active'
      `;
      remaining -= avail;
    } else {
      // Partial consumption: shrink the active row and record the applied slice
      // as a used row pinned to this booking.
      await db`
        UPDATE arvo.credits SET amount_cents = amount_cents - ${take} WHERE id = ${id}
      `;
      await db`
        INSERT INTO arvo.credits
          (customer_email, customer_id, amount_cents, currency, expires_at, status, source_booking_id, applied_to_booking_id, used_at)
        VALUES
          (${r.customer_email}, ${r.customer_id ?? null}, ${take}, ${r.currency}, ${r.expires_at}, 'used', ${Number(r.source_booking_id)}, ${bookingId}, now())
      `;
      remaining = 0;
    }
  }
  if (remaining > 0) {
    console.error(
      `[arvo:credits] short on credits: consumed ${amountCents - remaining}/${amountCents}¢ for booking ${bookingId}`,
    );
  }
}

/**
 * Who may act on a pending-decision booking:
 *   - the single-use decision token from the cancellation email links, OR
 *   - a logged-in session whose email matches the booking's customer email.
 * Only the customer themself ever passes — there is no owner/customer cancel
 * shortcut anywhere.
 */
async function resolveBookingActor(
  booking: Record<string, any>,
  token: string | undefined,
): Promise<{ canAct: boolean; isCustomer: boolean }> {
  if (token && booking.cancel_decision_token && booking.cancel_decision_token === token) {
    return { canAct: true, isCustomer: true };
  }
  if (token) {
    const user = await resolveSessionUser(token);
    if (user && user.email.toLowerCase() === String(booking.customer_email).toLowerCase()) {
      return { canAct: true, isCustomer: true };
    }
  }
  return { canAct: false, isCustomer: false };
}

/** en-AU long date/time, e.g. "Monday 25 July, 10:00 am" (shared by emails). */
function formatBookingDate(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface CustomerCreditsResult {
  ok: boolean;
  error?: string;
  email?: string;
  credits: CreditView[];
  totals: { activeCents: number; usedCents: number; expiredCents: number };
}

/**
 * A customer's credit balance — used by the checkout (match by typed email) and
 * the account page (session token; the token's email wins when both are given).
 * Active credits past their expiry are returned as effectiveStatus 'expired'
 * (forfeited) and are never usable at checkout.
 */
export const getCustomerCredits = createServerFn()
  .validator((d: { email?: string; token?: string }) => d)
  .handler(async ({ data }): Promise<CustomerCreditsResult> => {
    let email: string | undefined = data.email ? data.email.trim().toLowerCase() : undefined;
    if (data.token) {
      const user = await resolveSessionUser(data.token);
      if (user) email = user.email.toLowerCase();
    }
    if (!email) {
      return {
        ok: false,
        error: "No email to look up credits for.",
        credits: [],
        totals: { activeCents: 0, usedCents: 0, expiredCents: 0 },
      };
    }
    const db = sql();
    // Opportunistically forfeit observed-expired credits so the ledger stays tidy.
    await db`
      UPDATE arvo.credits SET status = 'expired'
      WHERE customer_email = ${email} AND status = 'active' AND expires_at <= now()
    `;
    const now = Date.now();
    const rows = await db`
      SELECT id, customer_email, customer_id, amount_cents, currency, expires_at,
             status, source_booking_id, applied_to_booking_id, used_at, created_at
      FROM arvo.credits
      WHERE customer_email = ${email}
      ORDER BY created_at DESC
    `;
    const credits: CreditView[] = (rows as Record<string, any>[]).map((r) => {
      const c = rowToCredit(r);
      const expired = c.status === "active" && new Date(c.expires_at).getTime() <= now;
      return { ...c, effectiveStatus: expired ? "expired" : c.status };
    });
    const sum = (s: CreditStatus) =>
      credits.filter((c) => c.effectiveStatus === s).reduce((acc, c) => acc + c.amount_cents, 0);
    return {
      ok: true,
      email,
      credits,
      totals: { activeCents: sum("active"), usedCents: sum("used"), expiredCents: sum("expired") },
    };
  });

export interface CancellationChoiceContext {
  ok: boolean;
  error?: string;
  booking?: {
    id: number;
    reference: string;
    shopName: string;
    serviceName: string | null;
    slotStartsAt: string | null;
    paid: boolean;
    /** booking value (service + fee) — the credit amount offered */
    totalCents: number;
    /** credit expiry shown in the UI (90 days from issue) */
    creditExpiresAt: string;
    /** true when the caller may act on this booking (email-link token or the customer's own session) */
    canAct: boolean;
  };
}

/**
 * Context for the "what happens next" page after a business cancellation.
 * Validates the caller (decision token from the email link, or the customer's
 * own session) and returns the booking summary + credit offer.
 */
export const getCancellationContext = createServerFn()
  .validator((d: { bookingId: number; token?: string }) => d)
  .handler(async ({ data }): Promise<CancellationChoiceContext> => {
    const db = sql();
    const rows = await db`
      SELECT b.*, s.name AS shop_name, sv.name AS service_name, sl.starts_at AS slot_starts
      FROM arvo.bookings b
      JOIN arvo.shops s ON s.id = b.shop_id
      LEFT JOIN arvo.services sv ON sv.id = b.service_id
      LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
      WHERE b.id = ${data.bookingId}
    `;
    if (rows.length === 0) return { ok: false, error: "Booking not found." };
    const b = rows[0] as Record<string, any>;
    if (b.status !== "cancellation_pending") {
      return {
        ok: false,
        error:
          "This booking is not waiting for a decision — it may already have been rescheduled or cancelled.",
      };
    }
    const actor = await resolveBookingActor(b, data.token);
    return {
      ok: true,
      booking: {
        id: Number(b.id),
        reference: `ARVO-${String(Number(b.id)).padStart(4, "0")}`,
        shopName: b.shop_name,
        serviceName: b.service_name,
        slotStartsAt: b.slot_starts ? new Date(b.slot_starts).toISOString() : null,
        paid: Boolean(b.paid),
        totalCents: Number(b.total_cents ?? b.service_cents ?? 0),
        creditExpiresAt: new Date(
          Date.now() + CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
        canAct: actor.canAct,
      },
    };
  });

/**
 * Slots the customer can move a pending-decision booking to: only slots in the
 * SAME mobile business, open, future by at least the 3h window, and not taken
 * by another active booking. The booking's own old slot is excluded (the owner
 * cancelled that time). Caller must be the customer.
 */
export const getRescheduleSlots = createServerFn()
  .validator((d: { bookingId: number; token?: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; error?: string; slots?: SlotRow[] }> => {
      const db = sql();
      const rows = await db`SELECT * FROM arvo.bookings WHERE id = ${data.bookingId}`;
      if (rows.length === 0) return { ok: false, error: "Booking not found." };
      const b = rows[0] as Record<string, any>;
      if (b.status !== "cancellation_pending") {
        return { ok: false, error: "This booking is not awaiting a decision." };
      }
      const actor = await resolveBookingActor(b, data.token);
      if (!actor.canAct) {
        return { ok: false, error: "You don't have permission to reschedule this booking." };
      }
      const shopId = Number(b.shop_id);
      const cutoff = new Date(Date.now() + MIN_LEAD_MS);
      const slotRows = await db`
        SELECT id, shop_id, starts_at, ends_at, is_open
        FROM arvo.slots
        WHERE shop_id = ${shopId}
          AND id <> ${Number(b.slot_id ?? 0)}
          AND is_open = true
          AND starts_at > ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM arvo.bookings x
            WHERE x.slot_id = arvo.slots.id
              AND x.status NOT IN ('cancelled', 'cancellation_pending')
          )
        ORDER BY starts_at ASC
      `;
      return {
        ok: true,
        slots: slotRows.map((r: Record<string, any>) => ({
          id: Number(r.id),
          shop_id: Number(r.shop_id),
          starts_at: new Date(r.starts_at).toISOString(),
          ends_at: new Date(r.ends_at).toISOString(),
          is_open: Boolean(r.is_open),
        })),
      };
    },
  );

/**
 * Customer chooses RESCHEDULE after a business cancellation: the SAME booking
 * record (and payment) moves to a new slot for the same service in the same
 * mobile business. Paid bookings become 'rescheduled'; unpaid ones stay
 * 'awaiting_payment' until the card charge lands. The owner is emailed the new
 * time and the customer gets a new-time confirmation.
 */
export const rescheduleBooking = createServerFn()
  .validator((d: { bookingId: number; slotId: number; token?: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; error?: string; booking?: BookingView }> => {
      try {
        const db = sql();
        const rows = await db`SELECT * FROM arvo.bookings WHERE id = ${data.bookingId}`;
        if (rows.length === 0) return { ok: false, error: "Booking not found." };
        const b = rows[0] as Record<string, any>;
        if (b.status !== "cancellation_pending") {
          return {
            ok: false,
            error:
              "This booking is not awaiting a decision — it may already have been rescheduled or cancelled.",
          };
        }
        const actor = await resolveBookingActor(b, data.token);
        if (!actor.canAct) {
          return { ok: false, error: "You don't have permission to reschedule this booking." };
        }

        const shopId = Number(b.shop_id);
        const slotRows = await db`
          SELECT * FROM arvo.slots WHERE id = ${data.slotId} AND shop_id = ${shopId}
        `;
        if (slotRows.length === 0) return { ok: false, error: "Slot not available." };
        const slot = slotRows[0] as Record<string, any>;
        if (!slot.is_open) return { ok: false, error: "This slot is closed." };
        if (new Date(slot.starts_at).getTime() < Date.now() + MIN_LEAD_MS) {
          return {
            ok: false,
            error: "This slot is too soon — bookings close 3 hours before the start time.",
          };
        }
        const taken = await db`
          SELECT 1 FROM arvo.bookings
          WHERE slot_id = ${data.slotId}
            AND id <> ${data.bookingId}
            AND status NOT IN ('cancelled', 'cancellation_pending')
        `;
        if (taken.length > 0) {
          return { ok: false, error: "Sorry, that time was just taken. Please choose another." };
        }

        const newStatus = Boolean(b.paid) ? "rescheduled" : "awaiting_payment";
        const updated = await db`
          UPDATE arvo.bookings
          SET slot_id = ${data.slotId},
              status = ${newStatus},
              cancel_decision_token = NULL
          WHERE id = ${data.bookingId} AND status = 'cancellation_pending'
          RETURNING *
        `;
        if (updated.length === 0) {
          return { ok: false, error: "This booking was already resolved. Please refresh." };
        }
        const booking = rowToBookingView(updated[0] as Record<string, any>);

        // Bounded, non-blocking notifications: customer gets the new time,
        // owner(s) get the new time.
        try {
          await sendRescheduleEmails(booking.id);
        } catch (e) {
          console.error(
            `[arvo:mail] reschedule emails failed for booking ${booking.id}:`,
            e instanceof Error ? e.message : e,
          );
        }
        return { ok: true, booking };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

/** Customer + owner emails after a booking moved to a new slot (never throws). */
async function sendRescheduleEmails(bookingId: number): Promise<void> {
  try {
    const db = sql();
    const rows = await db`
      SELECT b.id, b.customer_email, b.customer_name, b.shop_id,
             s.name AS shop_name,
             sv.name AS service_name,
             sl.starts_at AS slot_starts
      FROM arvo.bookings b
      JOIN arvo.shops s ON s.id = b.shop_id
      LEFT JOIN arvo.services sv ON sv.id = b.service_id
      LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
      WHERE b.id = ${bookingId}
    `;
    const r = rows[0] as Record<string, any> | undefined;
    if (!r || !r.customer_email) return;
    const when = formatBookingDate(r.slot_starts);
    const reference = `ARVO-${String(Number(r.id)).padStart(4, "0")}`;
    await sendBookingRescheduledEmail({
      to: r.customer_email,
      reference,
      shopName: r.shop_name,
      serviceName: r.service_name || "Car detailing",
      when,
    });
    const owners = await db`
      SELECT email, name FROM arvo.owners WHERE shop_id = ${Number(r.shop_id)} ORDER BY id ASC
    `;
    for (const ownerRow of owners as Record<string, any>[]) {
      if (!ownerRow.email) continue;
      try {
        await sendOwnerRescheduleNotificationEmail({
          to: ownerRow.email,
          ownerName: ownerRow.name || null,
          reference,
          shopName: r.shop_name,
          serviceName: r.service_name || "Car detailing",
          when,
          customerName: r.customer_name,
        });
      } catch (e) {
        console.error(
          `[arvo:mail] owner reschedule email failed for booking ${bookingId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    console.error(
      `[arvo:mail] reschedule emails failed for booking ${bookingId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Customer chooses CANCEL FOR CREDIT after a business cancellation: the booking
 * is cancelled (NO card refund) and the full amount paid (service + fee, i.e.
 * bookings.total_cents) becomes a 90-day credit for the customer's email. The
 * transaction ledger flips paid → 'credited' so the money trail stays exact.
 */
export const cancelBookingForCredit = createServerFn()
  .validator((d: { bookingId: number; token?: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; error?: string; credit?: CreditRow }> => {
      try {
        const db = sql();
        const rows = await db`SELECT * FROM arvo.bookings WHERE id = ${data.bookingId}`;
        if (rows.length === 0) return { ok: false, error: "Booking not found." };
        const b = rows[0] as Record<string, any>;
        if (b.status !== "cancellation_pending") {
          return {
            ok: false,
            error:
              "This booking is not awaiting a decision — it may already have been resolved.",
          };
        }
        const actor = await resolveBookingActor(b, data.token);
        if (!actor.canAct) {
          return { ok: false, error: "You don't have permission to cancel this booking." };
        }

        // Atomic flip to cancelled — only reachable from cancellation_pending,
        // so a double-tap (email link + account page) can never issue two credits.
        const updated = await db`
          UPDATE arvo.bookings
          SET status = 'cancelled', cancel_decision_token = NULL
          WHERE id = ${data.bookingId} AND status = 'cancellation_pending'
          RETURNING *
        `;
        if (updated.length === 0) {
          return { ok: false, error: "This booking was already resolved. Please refresh." };
        }
        const booking = rowToBookingView(updated[0] as Record<string, any>);

        // Credit = the total the customer actually paid (service + fee). Pre-fee
        // bookings have no total_cents — fall back to the service amount.
        const creditCents = booking.total_cents ?? booking.service_cents ?? 0;
        const expiresAt = new Date(Date.now() + CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const inserted = await db`
          INSERT INTO arvo.credits
            (customer_email, customer_id, amount_cents, currency, expires_at, status, source_booking_id)
          VALUES
            (${booking.customer_email}, ${booking.customer_id}, ${creditCents}, 'aud', ${expiresAt}, 'active', ${booking.id})
          RETURNING *
        `;
        await db`
          UPDATE arvo.transactions
          SET status = 'credited'
          WHERE booking_id = ${booking.id} AND status = 'paid'
        `;

        // Bounded, non-blocking customer email with the credit details.
        try {
          await sendCreditIssuedEmail({
            to: booking.customer_email,
            reference: `ARVO-${String(booking.id).padStart(4, "0")}`,
            shopName: booking.shopName,
            serviceName: booking.serviceName || "Car detailing",
            amountCents: creditCents,
            expiresAt,
          });
        } catch (e) {
          console.error(
            `[arvo:mail] credit-issued email failed for booking ${booking.id}:`,
            e instanceof Error ? e.message : e,
          );
        }

        return { ok: true, credit: rowToCredit(inserted[0] as Record<string, any>) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

/**
 * THE only cancellation path in the app: the mobile business owner cancels a
 * booking from their dashboard. Server-side enforced — requires an owner session
 * whose shop owns the booking; customers have no cancellation endpoint, so the
 * customer cannot cancel under any circumstances. The customer is emailed the
 * two options (reschedule / cancel-for-credit) with working links.
 */
export const cancelBookingByOwner = createServerFn()
  .validator((d: { token: string; bookingId: number; slug: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; error?: string; booking?: BookingView }> => {
      try {
        const user = await resolveSessionUser(data.token);
        if (!user || user.role !== "owner") {
          return { ok: false, error: "Only the mobile business owner can cancel a booking." };
        }
        const db = sql();
        const rows = await db`
          SELECT b.*, s.name AS shop_name, sv.name AS service_name, sl.starts_at AS slot_starts
          FROM arvo.bookings b
          JOIN arvo.shops s ON s.id = b.shop_id
          LEFT JOIN arvo.services sv ON sv.id = b.service_id
          LEFT JOIN arvo.slots sl ON sl.id = b.slot_id
          WHERE b.id = ${data.bookingId}
        `;
        if (rows.length === 0) return { ok: false, error: "Booking not found." };
        const b = rows[0] as Record<string, any>;
        if (user.shopId == null || user.shopId !== Number(b.shop_id)) {
          return { ok: false, error: "You can only cancel bookings for your own business." };
        }
        const cancellable = ["pending", "awaiting_payment", "confirmed"];
        if (!cancellable.includes(String(b.status))) {
          return { ok: false, error: "This booking is not active and can't be cancelled." };
        }

        // Single-use decision token embedded in the customer's email links.
        const decisionToken = await newSingleUseToken();
        const updated = await db`
          UPDATE arvo.bookings
          SET status = 'cancellation_pending',
              cancelled_at = now(),
              cancel_decision_token = ${decisionToken}
          WHERE id = ${data.bookingId}
            AND status IN ('pending', 'awaiting_payment', 'confirmed')
          RETURNING *
        `;
        if (updated.length === 0) {
          return { ok: false, error: "This booking changed state — refresh and try again." };
        }
        const booking = rowToBookingView(updated[0] as Record<string, any>);

        // Email the customer the two options with real links (bounded).
        try {
          const rescheduleUrl = `${config.appBaseUrl}/reschedule/${booking.id}?token=${decisionToken}`;
          const creditUrl = `${rescheduleUrl}&action=credit`;
          await sendBookingCancelledByOwnerEmail({
            to: booking.customer_email,
            reference: `ARVO-${String(booking.id).padStart(4, "0")}`,
            shopName: b.shop_name,
            serviceName: b.service_name || "Car detailing",
            when: b.slot_starts ? formatBookingDate(b.slot_starts) : null,
            rescheduleUrl,
            creditUrl,
            amountCents: Number(booking.total_cents ?? booking.service_cents ?? 0),
          });
        } catch (e) {
          console.error(
            `[arvo:mail] owner-cancellation email failed for booking ${booking.id}:`,
            e instanceof Error ? e.message : e,
          );
        }

        return { ok: true, booking };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
