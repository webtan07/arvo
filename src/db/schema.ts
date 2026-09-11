import { sql } from "./connection";

/**
 * Booking-domain DDL for Arvo (car-detailing booking web app).
 *
 * Everything lives under the dedicated Postgres schema `arvo` so it never
 * collides with the other apps (`fed`, `public`) sharing the same Neon account.
 * Roughly the minimal shape a multi-shop booking flow needs:
 *
 *   shops        — detailing locations (name, slug, address, photos, description)
 *   services     — what a shop offers (name, duration, price_cents, description)
 *   slots        — bookable time slots per shop + day (start/end, open status)
 *   bookings     — customer detail + chosen service/slot + status + payment option
 *   reviews      — customer reviews per mobile service (Phase B part 4):
 *                  exactly one review per booking (booking_id UNIQUE), only for
 *                  completed bookings; rating 1–5 + a required comment.
 *
 * This is intentionally a minimal scaffold: the full booking UI, availability
 * generation and payments are later steps.
 */
export const SCHEMA = "arvo";

/**
 * Status values (Phase B part 2 — owner-only cancellations + credits):
 *
 * arvo.bookings.status:
 *   'pending'              legacy default (pre-payment-flow bookings)
 *   'awaiting_payment'     created, card charge in flight (pay_online)
 *   'confirmed'            card charge succeeded (or paid in full by credit)
 *   'cancellation_pending' business owner cancelled; CUSTOMER must choose
 *                          reschedule OR cancel-for-credit. Slot is freed for
 *                          new bookings; reminders are suppressed. Customers
 *                          can NEVER cancel on their own — only the owner can
 *                          initiate this state (server-enforced).
 *   'rescheduled'          customer chose RESCHEDULE: same booking record +
 *                          payment, moved to a new slot for the same service.
 *   'completed'            final state (Phase B part 3) — the mobile business
 *                          owner marked the job done from their dashboard for a
 *                          booking that was 'confirmed' or 'rescheduled'. The
 *                          owner uploads a required photo of the serviced
 *                          vehicle at the same time; the customer is emailed
 *                          the photo + a review link. 'completed' bookings are
 *                          no longer actionable (no cancel / no re-complete).
 *   'cancelled'            final state. Reached ONLY via the customer choosing
 *                          "cancel for credit" after an owner cancellation
 *                          (credit row issued, no card refund).
 *
 * Older queries that exclude cancelled bookings treat 'cancellation_pending'
 * the same way (a pending-decision booking does not occupy its slot).
 *
 * arvo.transactions.status:
 *   'pending'  -> 'paid' on successful card charge
 *   'credited'  final state when the booking is cancelled-for-credit — the
 *               money was NOT refunded to the card; it became an arvo.credits
 *               row for the customer.
 *
 * Service completion (Phase B part 3) does NOT change transactions.status: the
 * money lifecycle stays 'paid' (nothing about the money changed — it moved when
 * the card charge succeeded). Completion is recorded with `completed_at` on BOTH
 * the booking row and the transaction row, so analytics/history can split
 * 'delivered' vs 'paid' while payment state stays exact.
 *
 * arvo.credits.status:
 *   'active' -> 'used' (applied at checkout) | 'expired' (forfeited, 90 days)
 */

export const CREATE_TABLES: string[] = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.shops (
    id          BIGSERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    address     TEXT,
    photos      JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    schedule    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.services (
    id           BIGSERIAL PRIMARY KEY,
    shop_id      BIGINT NOT NULL REFERENCES ${SCHEMA}.shops(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 60,
    price_cents  INTEGER NOT NULL DEFAULT 0,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shop_id, slug)
  )`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.slots (
    id         BIGSERIAL PRIMARY KEY,
    shop_id    BIGINT NOT NULL REFERENCES ${SCHEMA}.shops(id) ON DELETE CASCADE,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ NOT NULL,
    is_open    BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.bookings (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT NOT NULL REFERENCES ${SCHEMA}.shops(id) ON DELETE CASCADE,
    service_id      BIGINT REFERENCES ${SCHEMA}.services(id),
    slot_id         BIGINT REFERENCES ${SCHEMA}.slots(id),
    customer_name   TEXT NOT NULL,
    customer_email  TEXT NOT NULL,
    customer_phone  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- payment_option: 'pay_online' (card at booking) | 'pay_on_day' (no charge now)
    payment_option  TEXT,
    -- Paid flag: true once the Stripe card payment succeeded (pay_online).
    -- pay_on_day bookings stay unpaid until settled at the shop.
    paid            BOOLEAN NOT NULL DEFAULT false,
    -- Stripe PaymentIntent id when the customer paid online (TEST MODE).
    payment_intent_id TEXT,
    -- Notification: dashboard shows unread (seen=false) bookings as new.
    seen            BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.customers (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    phone         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // Payment ledger: one row per booking from the moment the booking is created
  // (status 'pending') through payment success ('paid') and any later
  // cancellation/refund ('refunded'). This is the foundation for owner
  // transaction history + admin analytics (later Phase B work).
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.transactions (
    id                BIGSERIAL PRIMARY KEY,
    booking_id        BIGINT NOT NULL REFERENCES ${SCHEMA}.bookings(id) ON DELETE CASCADE,
    shop_id           BIGINT NOT NULL REFERENCES ${SCHEMA}.shops(id),
    service_id        BIGINT REFERENCES ${SCHEMA}.services(id),
    customer_id       BIGINT,
    customer_name     TEXT NOT NULL,
    customer_email    TEXT NOT NULL,
    -- Amount split: service price + Stripe fee surcharge = total carded
    service_cents     INTEGER NOT NULL,
    fee_cents         INTEGER NOT NULL,
    total_cents       INTEGER NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'aud',
    -- 'pending' at booking creation -> 'paid' on successful card charge.
    status            TEXT NOT NULL DEFAULT 'pending',
    payment_method    TEXT,          -- 'card' (demo mode counts as card)
    payment_intent_id TEXT,          -- Stripe PaymentIntent id (TEST MODE)
    paid_at           TIMESTAMPTZ,   -- set when status flips to 'paid'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arvo_transactions_shop ON ${SCHEMA}.transactions (shop_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_arvo_transactions_booking ON ${SCHEMA}.transactions (booking_id)`,

  // Customer credit balance (Phase B part 2). A credit is issued ONLY when the
  // mobile business owner cancels a paid booking and the customer chooses
  // "cancel for credit" (no card refund — the money becomes store credit).
  // Credits match by customer email (guests included) or customer account.
  //   status: 'active' (usable) -> 'used' (applied at checkout) | 'expired'
  // Expiry: 90 days from issue (CREDIT_EXPIRY_DAYS in src/lib/fees.ts);
  // expired credits are forfeited and shown as expired in the UI.
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.credits (
    id                   BIGSERIAL PRIMARY KEY,
    customer_email       TEXT NOT NULL,
    customer_id          BIGINT,
    amount_cents         INTEGER NOT NULL,
    currency             TEXT NOT NULL DEFAULT 'aud',
    expires_at           TIMESTAMPTZ NOT NULL,
    status               TEXT NOT NULL DEFAULT 'active',
    source_booking_id    BIGINT NOT NULL REFERENCES ${SCHEMA}.bookings(id),
    applied_to_booking_id BIGINT,
    used_at              TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arvo_credits_email ON ${SCHEMA}.credits (customer_email, status)`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.owners (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    shop_id       BIGINT REFERENCES ${SCHEMA}.shops(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.sessions (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    user_role    TEXT NOT NULL,
    user_id      BIGINT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // Customer reviews per mobile service (Phase B part 4). ONE review per
  // completed booking (booking_id UNIQUE — server-enforced before insert too).
  // rating 1–5; comment is REQUIRED (richer reviews) and validated server-side
  // (trimmed, 10–2000 chars). customer_name/customer_email snapshot the booking
  // so the review survives even if the customer row changes; the public UI
  // renders reviewers as "First I." for privacy. Index (shop_id, created_at)
  // covers the shop page's newest-first review listing.
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.reviews (
    id             BIGSERIAL PRIMARY KEY,
    booking_id     BIGINT NOT NULL UNIQUE REFERENCES ${SCHEMA}.bookings(id) ON DELETE CASCADE,
    shop_id        BIGINT NOT NULL REFERENCES ${SCHEMA}.shops(id) ON DELETE CASCADE,
    service_id     BIGINT REFERENCES ${SCHEMA}.services(id) ON DELETE SET NULL,
    customer_id    BIGINT,
    customer_name  TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_arvo_reviews_shop ON ${SCHEMA}.reviews (shop_id, created_at)`,
];

// Idempotent column migrations for databases created before these columns existed.
// (CREATE TABLE IF NOT EXISTS won't add columns to an existing table, so ALTER ... IF
// NOT EXISTS keeps a previously-scaffolded database in sync.)
export const ALTER_TABLES: string[] = [
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS customer_id BIGINT`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS service_cents INTEGER`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS fee_cents INTEGER`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS total_cents INTEGER`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS reminder_email_sent_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS reminder_sms_sent_at TIMESTAMPTZ`,
  // Phase B part 2 (owner-only cancellations + credits):
  //   credit_applied_cents   — credit used at checkout (0 = none). PaymentIntent
  //                            amount = service + fee − credit applied.
  //   cancelled_at           — when the business owner cancelled the booking.
  //   cancel_decision_token  — random single-use token placed in the customer's
  //                            cancellation email links so a guest (or any
  //                            customer) can reschedule / choose credit without
  //                            logging in. Cleared when the choice is resolved.
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS cancel_decision_token TEXT`,
  // Transactions track the credit too: total_cents stays the NET cash that moved
  // (service + fee − credit); credit_applied_cents records the applied amount.
  `ALTER TABLE ${SCHEMA}.transactions ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0`,
  // Phase B part 3 (service completion + vehicle photo + transaction history):
  //   completion_photo_path     — data URL ("data:image/jpeg;base64,…") of the
  //                               required photo of the serviced vehicle the
  //                               owner uploads when completing the job. Stored
  //                               ON the booking so it cascades with it; shown
  //                               in <img> and embedded inline in the customer
  //                               email. Deliberately a data URL: this TanStack
  //                               version has no HTTP GET endpoint mechanism
  //                               (api/ routes are server-fn modules, POST via
  //                               /_serverFn), so a hosted image URL isn't
  //                               available — the data URL keeps the "path"
  //                               reference on the booking as specified.
  //   completed_at              — when the owner marked the job complete.
  //   completion_email_sent_at  — stamped when the completion email (photo +
  //                               review link) was successfully sent; non-null
  //                               means the customer was notified.
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS completion_photo_path TEXT`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS completion_email_sent_at TIMESTAMPTZ`,
  // Completion timestamp on the ledger too — money state ('paid') unchanged, but
  // the history view + future analytics split delivered vs merely-paid.
  `ALTER TABLE ${SCHEMA}.transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.shops ADD COLUMN IF NOT EXISTS schedule JSONB`,
  `ALTER TABLE ${SCHEMA}.owners ADD COLUMN IF NOT EXISTS name TEXT`,
  // Password-reset: a SHA-256 hash of the raw reset token (never the raw token)
  // plus its expiry. Both are cleared on successful reset (single-use) or when
  // the token expires.
  `ALTER TABLE ${SCHEMA}.customers ADD COLUMN IF NOT EXISTS reset_token_hash TEXT`,
  `ALTER TABLE ${SCHEMA}.customers ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ`,
  `ALTER TABLE ${SCHEMA}.owners ADD COLUMN IF NOT EXISTS reset_token_hash TEXT`,
  `ALTER TABLE ${SCHEMA}.owners ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ`,
];

/**
 * Run the canonical DDL (CREATE SCHEMA/TABLE IF NOT EXISTS) so a fresh database
 * self-heals on first use. Each statement runs on its own — the Neon serverless
 * driver executes single statements only, so a multi-statement string would
 * silently no-op. Failures are collected and surfaced once, after the full pass.
 */
export async function ensureSchema(): Promise<void> {
  const db = sql();
  const errors: string[] = [];
  const all = [...CREATE_TABLES, ...ALTER_TABLES];
  for (const statement of all) {
    try {
      await db`${db.unsafe(statement)}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[arvo:schema] statement failed: ${msg}`);
      errors.push(`${statement.split("\n")[0]} -> ${msg}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`[arvo:schema] ${errors.length} statement(s) failed: ${errors.join(" | ")}`);
  }
}

/** List the tables that exist in the `arvo` schema (for healthchecks). */
export async function listArvoTables(): Promise<string[]> {
  const db = sql();
  const rows = await db`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${SCHEMA}
    ORDER BY table_name
  `;
  return rows.map((r: Record<string, any>) => r.table_name as string);
}
