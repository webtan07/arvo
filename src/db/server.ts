import { createServerFn } from "@tanstack/react-start";
import { sql, requireEnv } from "./connection";
import { ensureSeed } from "./seed";
import { createPaymentIntent, formatAUD, getStripeConfig } from "./stripe";

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

export type PaymentOption = "pay_online" | "pay_on_day";

export interface CreateBookingInput {
  shopSlug: string;
  serviceSlug: string;
  slotId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paymentOption: PaymentOption;
}

export interface CreateBookingResult {
  ok: boolean;
  error?: string;
  booking?: BookingView;
  payment?: {
    mode: PaymentOption;
    amountCents: number;
    /** formatted price, e.g. "A$25.00" */
    amountDisplay: string;
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
      if (shops.length === 0) return { ok: false, error: "Shop not found." };
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

      const paymentOption: PaymentOption =
        data.paymentOption === "pay_online" ? "pay_online" : "pay_on_day";

      let paymentIntentId: string | null = null;
      const stripe = getStripeConfig();

      // For pay_online WITH real Stripe keys, create the PaymentIntent up front.
      if (paymentOption === "pay_online" && stripe.hasKeys) {
        const pi = await createPaymentIntent({
          amountCents: priceCents,
          currency: "aud",
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          shopName: String(shop.name),
          serviceName: String(service.name),
        });
        paymentIntentId = pi.id;
      }

      const status = paymentOption === "pay_online" ? "awaiting_payment" : "confirmed";

      const inserted = await db`
        INSERT INTO arvo.bookings
          (shop_id, service_id, slot_id, customer_name, customer_email, customer_phone, status, payment_option, paid, payment_intent_id)
        VALUES
          (${shopId}, ${serviceId}, ${slotId}, ${data.customerName}, ${data.customerEmail}, ${data.customerPhone || null}, ${status}, ${paymentOption}, false, ${paymentIntentId})
        RETURNING *
      `;
      const booking = rowToBookingView(inserted[0] as Record<string, any>);

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
          amountCents: priceCents,
          amountDisplay: formatAUD(priceCents),
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
    await db`
      UPDATE arvo.bookings
      SET status = 'confirmed', paid = true
      WHERE id = ${id} AND status = 'awaiting_payment'
    `;
    return true;
  });

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

/** Shop dashboard: shop + upcoming bookings + unread notification count. */
export const getDashboard = createServerFn()
  .validator((d: string) => d)
  .handler(
    async ({
      data: slug,
    }): Promise<{
      shop: ShopRow | null;
      bookings: BookingView[];
      unread: number;
    }> => {
      await ensureSeed();
      const db = sql();
      const shops = await db`SELECT * FROM arvo.shops WHERE slug = ${slug}`;
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
