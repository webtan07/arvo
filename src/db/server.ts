import { createServerFn } from "@tanstack/react-start";
import { sql, requireEnv } from "./connection";
import { ensureSeed } from "./seed";
import { createPaymentIntent, formatAUD, getStripeConfig } from "./stripe";
import { sendBookingConfirmationEmail, sendOwnerBookingNotificationEmail } from "~/lib/mail";
import { calculateFees, resolveFeeConfig, FEE_CURRENCY, type FeeConfig } from "~/lib/fees";
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
          SELECT 1 FROM arvo.bookings b WHERE b.slot_id = arvo.slots.id AND b.status <> 'cancelled'
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
          SELECT 1 FROM arvo.bookings b WHERE b.slot_id = arvo.slots.id AND b.status <> 'cancelled'
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
    /** total carded in cents (service + fee) */
    totalCents: number;
    /** formatted total, e.g. "A$26.03" */
    amountDisplay: string;
    /** formatted service price, e.g. "A$25.00" */
    serviceDisplay: string;
    /** formatted fee, e.g. "A$1.03" */
    feeDisplay: string;
    /** fee rate summary, e.g. "2.9% + A$0.30" */
    rateLabel: string;
    hasKeys: boolean;
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
        SELECT 1 FROM arvo.bookings WHERE slot_id = ${slotId} AND status <> 'cancelled'
      `;
      if (taken.length > 0) return { ok: false, error: "Sorry, that slot was just taken. Please choose another." };

      // Every booking pays now: create the PaymentIntent up front when real
      // Stripe keys are configured (otherwise the UI runs in demo mode).
      // The customer pays service price + Stripe fee surcharge (2.9% + 30¢ AUD
      // by default — see src/lib/fees.ts), so the intent amount is the TOTAL.
      const paymentOption: PaymentOption = "pay_online";
      let paymentIntentId: string | null = null;
      const stripe = getStripeConfig();
      const feeCfg: FeeConfig = resolveFeeConfig(process.env);
      const { feeCents, totalCents } = calculateFees(priceCents, feeCfg);

      if (stripe.hasKeys) {
        const pi = await createPaymentIntent({
          amountCents: totalCents, // service + fee — this is what gets carded
          currency: "aud",
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          shopName: String(shop.name),
          serviceName: String(service.name),
        });
        paymentIntentId = pi.id;
      }

      const status = "awaiting_payment";

      const inserted = await db`
        INSERT INTO arvo.bookings
          (shop_id, service_id, slot_id, customer_id, customer_name, customer_email, customer_phone, status, payment_option, paid, payment_intent_id, service_cents, fee_cents, total_cents)
        VALUES
          (${shopId}, ${serviceId}, ${slotId}, ${data.customerId ?? null}, ${data.customerName}, ${data.customerEmail}, ${data.customerPhone || null}, ${status}, ${paymentOption}, false, ${paymentIntentId}, ${priceCents}, ${feeCents}, ${totalCents})
        RETURNING *
      `;
      const booking = rowToBookingView(inserted[0] as Record<string, any>);

      // Payment ledger row — created 'pending' with the booking, flipped to
      // 'paid' by markBookingPaid when the card charge succeeds. This is the
      // record later Phase B work (owner transaction history, admin analytics,
      // cancellations/refunds) builds on.
      const txInserted = await db`
        INSERT INTO arvo.transactions
          (booking_id, shop_id, service_id, customer_id, customer_name, customer_email, service_cents, fee_cents, total_cents, currency, status, payment_method, payment_intent_id)
        VALUES
          (${booking.id}, ${shopId}, ${serviceId}, ${data.customerId ?? null}, ${data.customerName}, ${data.customerEmail}, ${priceCents}, ${feeCents}, ${totalCents}, 'aud', 'pending', 'card', ${paymentIntentId})
        RETURNING id
      `;
      if (txInserted.length === 0) {
        console.error(`[arvo:tx] transaction row not created for booking ${booking.id}`);
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
          amountDisplay: formatAUD(totalCents),
          serviceDisplay: formatAUD(priceCents),
          feeDisplay: formatAUD(feeCents),
          rateLabel: `${feeCfg.percent}% + ${formatAUD(feeCfg.fixedCents)}`,
          hasKeys: stripe.hasKeys,
          ...(clientSecret && stripe.hasKeys
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
             b.service_cents, b.fee_cents, b.total_cents, b.shop_id,
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
  const unread = bookings.filter((b) => b.status !== "cancelled" && !b.seen).length;
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
