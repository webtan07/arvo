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
 *
 * This is intentionally a minimal scaffold: the full booking UI, availability
 * generation and payments are later steps.
 */
export const SCHEMA = "arvo";

export const CREATE_TABLES: string[] = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,

  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.shops (
    id          BIGSERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    address     TEXT,
    photos      JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
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
];

// Idempotent column migrations for databases created before these columns existed.
// (CREATE TABLE IF NOT EXISTS won't add columns to an existing table, so ALTER ... IF
// NOT EXISTS keeps a previously-scaffolded database in sync.)
export const ALTER_TABLES: string[] = [
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`,
  `ALTER TABLE ${SCHEMA}.bookings ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false`,
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
