/**
 * Super-admin analytics (Phase B part 5 — FINAL).
 *
 * Two kinds of admin account, both VIEW-ONLY (no admin mutation exists anywhere
 * in this phase — the Arvo owner's spec for the super admin is "view" only):
 *
 *   superadmin        — the Arvo owner (creator of the platform).
 *   analytics_viewer  — the Arvo owner's view-only analytics account.
 *
 * Both see identical analytics data; the only difference surfaced in the UI is
 * the role badge (Super Admin vs View-only). There are NO edit/action controls
 * on any admin page, and every admin server function in this module performs
 * SELECT-only queries.
 *
 * Admin sessions are deliberately SEPARATE from customer/owner sessions:
 *   - a distinct opaque token stored by the client under its own key
 *     ("arvo.admin.session" — see src/lib/adminSession.ts),
 *   - issued/validated only via the helpers in THIS module (never
 *     resolveSessionUser / getSessionUser), and
 *   - stored in the shared arvo.sessions table with user_role = 'admin', which
 *     means resolveSessionUser (customer/owner path) can NEVER resolve an admin
 *     token — every existing mutating server fn therefore rejects admin
 *     sessions by construction.
 *
 * Admin accounts are BOOTSTRAPPED from env vars at ensureSchema time
 * (idempotent upsert by email, scrypt-hashed server-side — the same scheme as
 * owners/customers):
 *   SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD    → role 'superadmin'
 *   ANALYTICS_EMAIL / ANALYTICS_PASSWORD      → role 'analytics_viewer'
 * If the vars are absent a warning is logged and no admin rows are created
 * (the deployment can set them later).
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "./connection";
import { hashPassword, verifyPassword } from "./auth";
import { ensureSchema } from "./schema";

let _crypto: typeof import("node:crypto") | null = null;
async function nodeCrypto() {
  if (!_crypto) _crypto = await import("node:crypto");
  return _crypto;
}

export type AdminRole = "superadmin" | "analytics_viewer";

export interface AdminSessionUser {
  role: AdminRole;
  id: number;
  email: string;
}

export interface AdminAuthResult {
  ok: boolean;
  error?: string;
  sessionToken?: string;
}

const ADMIN_SESSION_DAYS = 30;

/* ── admin session tokens (separate from customer/owner sessions) ── */

async function newAdminToken(): Promise<string> {
  const { randomBytes } = await nodeCrypto();
  return randomBytes(32).toString("base64url");
}

async function adminTokenHash(token: string): Promise<string> {
  const { createHash } = await nodeCrypto();
  return createHash("sha256").update(token).digest("hex");
}

function adminSessionExpiry(): Date {
  return new Date(Date.now() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000);
}

/** Store an admin session token (user_role 'admin' → arvo.sessions). */
async function insertAdminSession(token: string, adminId: number): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO arvo.sessions (token_hash, user_role, user_id, expires_at)
    VALUES (${await adminTokenHash(token)}, 'admin', ${adminId}, ${adminSessionExpiry()})
  `;
}

/**
 * Resolve an admin session token → admin user (role + email), verifying it
 * exists, is unexpired, has user_role 'admin', and the admin row still exists.
 * Plain (non-server-fn) helper so other server functions can reuse it.
 */
export async function resolveAdminSession(token: string): Promise<AdminSessionUser | null> {
  if (!token) return null;
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT s.user_role, s.user_id, s.expires_at
    FROM arvo.sessions s
    WHERE s.token_hash = ${await adminTokenHash(token)}
  `;
  const s = rows[0] as
    | { user_role: string; user_id: number; expires_at: Date }
    | undefined;
  if (!s || s.user_role !== "admin") return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  const a = await db`
    SELECT id, email, role FROM arvo.admins WHERE id = ${Number(s.user_id)}
  `;
  if (a.length === 0) return null;
  const row = a[0] as { id: number; email: string; role: string };
  const role = row.role === "superadmin" ? ("superadmin" as const) : ("analytics_viewer" as const);
  return { role, id: Number(row.id), email: row.email };
}

/* ── env bootstrap (called from ensureSchema) ─────────────────── */

let _adminBootstrapRan = false;

/**
 * Idempotent env → arvo.admins bootstrap. Runs once per process (a fresh
 * serverless process re-runs it each invocation, which is safe — the upsert is
 * by email and re-hashes the env password, keeping env the single source of
 * truth for admin credentials until an admin password-change flow exists).
 */
export async function bootstrapAdmins(): Promise<void> {
  if (_adminBootstrapRan) return;
  _adminBootstrapRan = true;

  const candidates: { email?: string; password?: string; role: AdminRole }[] = [
    {
      email: process.env.SUPERADMIN_EMAIL,
      password: process.env.SUPERADMIN_PASSWORD,
      role: "superadmin",
    },
    {
      email: process.env.ANALYTICS_EMAIL,
      password: process.env.ANALYTICS_PASSWORD,
      role: "analytics_viewer",
    },
  ];
  const configured = candidates.filter(
    (c) => c.email && c.email.trim() && c.password && c.password.length > 0,
  );
  if (configured.length === 0) {
    console.warn(
      "[arvo:admin] No SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD or " +
        "ANALYTICS_EMAIL/ANALYTICS_PASSWORD env vars set — skipping admin " +
        "bootstrap (the /admin analytics dashboard will have no accounts).",
    );
    return;
  }

  const db = sql();
  for (const c of configured) {
    const email = (c.email as string).trim().toLowerCase();
    const passwordHash = await hashPassword(c.password as string);
    await db`
      INSERT INTO arvo.admins (email, password_hash, role)
      VALUES (${email}, ${passwordHash}, ${c.role})
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
    `;
    console.log(`[arvo:admin] bootstrapped admin account ${email} (${c.role})`);
  }
}

/* ── auth server fns (admin-only, separate cookie/session) ────── */

/** Log in an admin (superadmin or analytics_viewer). Generic error on mismatch. */
export const loginAdmin = createServerFn()
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }): Promise<AdminAuthResult> => {
    await ensureSchema();
    const db = sql();
    const email = data.email.trim().toLowerCase();
    const rows = await db`
      SELECT id, password_hash, role FROM arvo.admins WHERE email = ${email}
    `;
    const row = rows[0] as
      | { id: number; password_hash: string; role: string }
      | undefined;
    if (!row || !(await verifyPassword(data.password, row.password_hash))) {
      return { ok: false, error: "Incorrect email or password." };
    }
    const token = await newAdminToken();
    await insertAdminSession(token, Number(row.id));
    await db`
      UPDATE arvo.admins SET last_login_at = now() WHERE id = ${Number(row.id)}
    `;
    return { ok: true, sessionToken: token };
  });

/** Revoke an admin session token (logout). */
export const logoutAdmin = createServerFn()
  .validator((d: string) => d)
  .handler(async ({ data: token }): Promise<boolean> => {
    if (!token) return false;
    const db = sql();
    await db`DELETE FROM arvo.sessions WHERE token_hash = ${await adminTokenHash(token)}`;
    return true;
  });

/** Resolve the current admin session client-side. */
export const getAdminSession = createServerFn()
  .validator((d: string) => d)
  .handler(
    async ({ data: token }): Promise<AdminSessionUser | null> =>
      resolveAdminSession(token),
  );

/* ── analytics data (ALL VIEW-ONLY, admin session required) ───── */

type AdminDataAccess = "guest" | "ok";

/** Guard used by every analytics server fn — rejects non-admin sessions. */
async function requireAdmin(
  token: string,
): Promise<{ ok: true; admin: AdminSessionUser } | { ok: false }> {
  const admin = await resolveAdminSession(token);
  if (!admin) return { ok: false };
  return { ok: true, admin };
}

export interface AdminOverview {
  /** Gross earnings (paid): sum of transactions.total_cents where status='paid'. */
  grossEarningsCents: number;
  /** Net cash after fees: sum of (total_cents − fee_cents) for paid transactions. */
  netCashAfterFeesCents: number;
  paidTransactions: number;
  totalBookings: number;
  completedBookings: number;
  /** Businesses with at least one booking. */
  activeBusinesses: number;
  /** All registered businesses (shops). */
  registeredBusinesses: number;
  /** Distinct customer emails (registered customers ∪ booking customers). */
  totalCustomers: number;
  /** Sum of ACTIVE (unused, unexpired) customer credits. */
  activeCreditsCents: number;
  activeCreditsCount: number;
  avgRating: number | null;
  reviewCount: number;
}

/** Overview cards — the headline "overall earnings" plus the rest. */
export const getAdminOverview = createServerFn()
  .validator((d: { token: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ access: AdminDataAccess; overview: AdminOverview | null }> => {
      const guard = await requireAdmin(data.token);
      if (!guard.ok) return { access: "guest", overview: null };

      const db = sql();

      const money = await db`
        SELECT COALESCE(SUM(total_cents), 0)::int AS gross,
               COALESCE(SUM(total_cents - fee_cents), 0)::int AS net,
               COUNT(*)::int AS paid_count
        FROM arvo.transactions
        WHERE status = 'paid'
      `;
      const moneyRow = money[0] as { gross: number; net: number; paid_count: number };

      const bookingCount = await db`
        SELECT COUNT(*)::int AS n,
               COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
        FROM arvo.bookings
      `;
      const bookingRow = bookingCount[0] as { n: number; completed: number };

      const activeBiz = await db`
        SELECT COUNT(DISTINCT shop_id)::int AS n FROM arvo.bookings
      `;
      const registeredBiz = await db`SELECT COUNT(*)::int AS n FROM arvo.shops`;

      const customers = await db`
        SELECT COUNT(*)::int AS n FROM (
          SELECT lower(email) AS email FROM arvo.customers
          UNION
          SELECT DISTINCT lower(customer_email) FROM arvo.bookings
        ) u
      `;

      const credits = await db`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS total,
               COUNT(*)::int AS n
        FROM arvo.credits
        WHERE status = 'active'
      `;
      const creditRow = credits[0] as { total: number; n: number };

      const reviews = await db`
        SELECT COUNT(*)::int AS n, AVG(rating)::float8 AS avg FROM arvo.reviews
      `;
      const reviewRow = reviews[0] as { n: number; avg: number | null };

      return {
        access: "ok",
        overview: {
          grossEarningsCents: Number(moneyRow.gross),
          netCashAfterFeesCents: Number(moneyRow.net),
          paidTransactions: Number(moneyRow.paid_count),
          totalBookings: Number(bookingRow.n),
          completedBookings: Number(bookingRow.completed),
          activeBusinesses: Number((activeBiz[0] as { n: number }).n),
          registeredBusinesses: Number((registeredBiz[0] as { n: number }).n),
          totalCustomers: Number((customers[0] as { n: number }).n),
          activeCreditsCents: Number(creditRow.total),
          activeCreditsCount: Number(creditRow.n),
          avgRating: reviewRow.avg == null ? null : Number(reviewRow.avg),
          reviewCount: Number(reviewRow.n),
        },
      };
    },
  );

export interface AdminBusinessRow {
  id: number;
  slug: string;
  name: string;
  created_at: string;
  bookings_count: number;
  paid_bookings_count: number;
  gross_cents: number;
  avg_rating: number | null;
  review_count: number;
}

/** One row per registered business with booking/earnings/review aggregates. */
export const getAdminBusinesses = createServerFn()
  .validator((d: { token: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ access: AdminDataAccess; rows: AdminBusinessRow[] }> => {
      const guard = await requireAdmin(data.token);
      if (!guard.ok) return { access: "guest", rows: [] };
      const db = sql();

      const rows = await db`
        SELECT s.id, s.slug, s.name, s.created_at,
               COUNT(DISTINCT b.id)::int AS bookings_count,
               COUNT(DISTINCT b.id) FILTER (WHERE tx.paid_cnt > 0)::int AS paid_bookings_count,
               COALESCE(MAX(tx.gross), 0)::int AS gross_cents,
               COALESCE(MAX(rv.avg_rating), NULL)::float8 AS avg_rating,
               COALESCE(MAX(rv.review_count), 0)::int AS review_count
        FROM arvo.shops s
        LEFT JOIN arvo.bookings b ON b.shop_id = s.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid'), 0)::int AS gross,
                 COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_cnt
          FROM arvo.transactions
          WHERE booking_id = b.id
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT AVG(rating)::float8 AS avg_rating, COUNT(*)::int AS review_count
          FROM arvo.reviews
          WHERE shop_id = s.id
        ) rv ON true
        GROUP BY s.id, s.slug, s.name, s.created_at
        ORDER BY COALESCE(MAX(tx.gross), 0) DESC, s.name
      `;

      const out: AdminBusinessRow[] = (rows as Record<string, any>[]).map((r) => ({
        id: Number(r.id),
        slug: r.slug,
        name: r.name,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        bookings_count: Number(r.bookings_count),
        paid_bookings_count: Number(r.paid_bookings_count),
        gross_cents: Number(r.gross_cents),
        avg_rating: r.avg_rating == null ? null : Number(r.avg_rating),
        review_count: Number(r.review_count),
      }));

      return { access: "ok", rows: out };
    },
  );

export interface AdminCustomerRow {
  email: string;
  name: string | null;
  /** True if the email has a registered customer account. */
  registered: boolean;
  bookings_count: number;
  /** Total spend: sum of paid transaction totals for this customer. */
  total_spend_cents: number;
  /** Available credit balance: sum of active credits for this customer. */
  available_credit_cents: number;
}

/** Customers table — registered customers plus guest bookers, by email. */
export const getAdminCustomers = createServerFn()
  .validator((d: { token: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ access: AdminDataAccess; rows: AdminCustomerRow[] }> => {
      const guard = await requireAdmin(data.token);
      if (!guard.ok) return { access: "guest", rows: [] };
      const db = sql();

      const rows = await db`
        SELECT base.email,
               c.id AS customer_id,
               c.name AS registered_name,
               ln.customer_name AS last_booking_name,
               COALESCE(bx.cnt, 0)::int AS bookings_count,
               COALESCE(bx.spend, 0)::int AS total_spend_cents,
               COALESCE(cx.credit, 0)::int AS available_credit_cents
        FROM (
          SELECT email FROM (
            SELECT lower(email) AS email FROM arvo.customers
            UNION
            SELECT DISTINCT lower(customer_email) FROM arvo.bookings
          ) u
        ) base
        LEFT JOIN arvo.customers c ON lower(c.email) = base.email
        LEFT JOIN LATERAL (
          SELECT customer_name FROM arvo.bookings
          WHERE lower(customer_email) = base.email
          ORDER BY created_at DESC LIMIT 1
        ) ln ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt,
                 COALESCE(SUM(tx.total_cents) FILTER (WHERE tx.status = 'paid'), 0)::int AS spend
          FROM arvo.bookings b
          JOIN arvo.transactions tx ON tx.booking_id = b.id
          WHERE lower(b.customer_email) = base.email
        ) bx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(amount_cents), 0)::int AS credit
          FROM arvo.credits
          WHERE lower(customer_email) = base.email AND status = 'active'
        ) cx ON true
        ORDER BY bx.spend DESC, base.email
      `;

      const out: AdminCustomerRow[] = (rows as Record<string, any>[]).map((r) => ({
        email: r.email,
        name: r.registered_name ?? r.last_booking_name ?? null,
        registered: r.customer_id != null,
        bookings_count: Number(r.bookings_count),
        total_spend_cents: Number(r.total_spend_cents),
        available_credit_cents: Number(r.available_credit_cents),
      }));

      return { access: "ok", rows: out };
    },
  );

export interface AdminTransactionRow {
  booking_id: number;
  reference: string;
  business_name: string;
  business_slug: string;
  service_name: string | null;
  customer_name: string;
  customer_email: string;
  /** bookings.status — the service lifecycle ('completed', 'cancelled', …). */
  booking_status: string;
  /** transactions.status — the money lifecycle ('paid', 'pending', 'credited'). */
  transaction_status: string;
  service_cents: number;
  fee_cents: number;
  total_cents: number;
  credit_applied_cents: number;
  net_cash_cents: number;
  payment_method: string | null;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface AdminTransactionsFilter {
  /** '' = all statuses; otherwise one of paid / pending / credited. */
  status?: string;
  /** Inclusive start date 'YYYY-MM-DD' (optional). */
  from?: string;
  /** Inclusive end date 'YYYY-MM-DD' (optional). */
  to?: string;
  /** Restrict to one business by slug (drill-down page). '' = all. */
  shopSlug?: string;
  /** Row cap (default 500 — filters should be used to narrow). */
  limit?: number;
}

/**
 * The full transaction ledger (transaction row + booking + business + service),
 * newest first. Used by the /admin transactions table and, scoped to one shop,
 * by the per-business drill-down page. Plain helper so other admin server fns
 * can reuse the same query without nesting server-fn calls.
 */
async function adminTransactionsQuery(
  db: ReturnType<typeof sql>,
  filter: AdminTransactionsFilter,
): Promise<AdminTransactionRow[]> {
  const status =
    filter.status === "paid" || filter.status === "pending" || filter.status === "credited"
      ? filter.status
      : "";
  const fromIso =
    typeof filter.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)
      ? filter.from
      : "";
  const toIso =
    typeof filter.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)
      ? filter.to
      : "";
  const shopSlug = typeof filter.shopSlug === "string" ? filter.shopSlug.trim() : "";
  const limit = Math.min(Math.max(Number(filter.limit) || 500, 1), 2000);

  const rows = await db`
    SELECT tx.booking_id, tx.status AS tx_status,
           tx.service_cents, tx.fee_cents, tx.total_cents,
           tx.credit_applied_cents, tx.payment_method,
           tx.created_at, tx.paid_at, tx.completed_at,
           s.name AS business_name, s.slug AS business_slug,
           sv.name AS service_name,
           b.customer_name, b.customer_email,
           b.status AS booking_status, b.cancelled_at
    FROM arvo.transactions tx
    JOIN arvo.bookings b ON b.id = tx.booking_id
    JOIN arvo.shops s ON s.id = tx.shop_id
    LEFT JOIN arvo.services sv ON sv.id = tx.service_id
    WHERE (${status} = '' OR tx.status = ${status})
      AND (${shopSlug} = '' OR s.slug = ${shopSlug})
      AND (${fromIso} = '' OR tx.created_at >= ${fromIso}::timestamptz)
      AND (${toIso} = '' OR tx.created_at < (${toIso}::timestamptz + interval '1 day'))
    ORDER BY tx.created_at DESC
    LIMIT ${limit}
  `;

  const isoOrNull = (v: unknown): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);

  return (rows as Record<string, any>[]).map((r) => {
    const svc = r.service_cents == null ? 0 : Number(r.service_cents);
    const fee = r.fee_cents == null ? 0 : Number(r.fee_cents);
    const credit = r.credit_applied_cents == null ? 0 : Number(r.credit_applied_cents);
    const total = r.total_cents == null ? svc + fee - credit : Number(r.total_cents);
    return {
      booking_id: Number(r.booking_id),
      reference: `ARVO-${String(Number(r.booking_id)).padStart(4, "0")}`,
      business_name: r.business_name,
      business_slug: r.business_slug,
      service_name: r.service_name == null ? null : r.service_name,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      booking_status: r.booking_status,
      transaction_status: r.tx_status,
      service_cents: svc,
      fee_cents: fee,
      total_cents: total,
      credit_applied_cents: credit,
      net_cash_cents: total,
      payment_method: r.payment_method == null ? null : r.payment_method,
      created_at: isoOrNull(r.created_at) ?? "",
      paid_at: isoOrNull(r.paid_at),
      completed_at: isoOrNull(r.completed_at),
      cancelled_at: isoOrNull(r.cancelled_at),
    };
  });
}

/** Server-fn wrapper for the ledger query (transactions table / drill-down). */
export const getAdminTransactions = createServerFn()
  .validator((d: { token: string } & AdminTransactionsFilter) => d)
  .handler(
    async ({
      data,
    }): Promise<{ access: AdminDataAccess; rows: AdminTransactionRow[] }> => {
      const guard = await requireAdmin(data.token);
      if (!guard.ok) return { access: "guest", rows: [] };
      const db = sql();
      const rows = await adminTransactionsQuery(db, {
        status: data.status,
        from: data.from,
        to: data.to,
        shopSlug: data.shopSlug,
        limit: data.limit,
      });
      return { access: "ok", rows };
    },
  );

export interface AdminReviewRow {
  id: number;
  booking_id: number;
  customer_name: string;
  customer_email: string;
  service_name: string | null;
  rating: number;
  comment: string;
  created_at: string;
}

export interface AdminBusinessDetail {
  shop: AdminBusinessRow;
  transactions: AdminTransactionRow[];
  reviews: AdminReviewRow[];
}

/** Per-business drill-down: shop aggregates + transactions + reviews. */
export const getAdminBusiness = createServerFn()
  .validator((d: { token: string; slug: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ access: AdminDataAccess; detail: AdminBusinessDetail | null }> => {
      const guard = await requireAdmin(data.token);
      if (!guard.ok) return { access: "guest", detail: null };
      const db = sql();

      const shopRows = await db`
        SELECT s.id, s.slug, s.name, s.created_at,
               COUNT(DISTINCT b.id)::int AS bookings_count,
               COUNT(DISTINCT b.id) FILTER (WHERE tx.paid_cnt > 0)::int AS paid_bookings_count,
               COALESCE(MAX(tx.gross), 0)::int AS gross_cents,
               COALESCE(MAX(rv.avg_rating), NULL)::float8 AS avg_rating,
               COALESCE(MAX(rv.review_count), 0)::int AS review_count
        FROM arvo.shops s
        LEFT JOIN arvo.bookings b ON b.shop_id = s.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid'), 0)::int AS gross,
                 COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_cnt
          FROM arvo.transactions
          WHERE booking_id = b.id
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT AVG(rating)::float8 AS avg_rating, COUNT(*)::int AS review_count
          FROM arvo.reviews
          WHERE shop_id = s.id
        ) rv ON true
        WHERE s.slug = ${data.slug}
        GROUP BY s.id, s.slug, s.name, s.created_at
      `;
      if (shopRows.length === 0) return { access: "ok", detail: null };
      const s = shopRows[0] as Record<string, any>;
      const shop: AdminBusinessRow = {
        id: Number(s.id),
        slug: s.slug,
        name: s.name,
        created_at: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
        bookings_count: Number(s.bookings_count),
        paid_bookings_count: Number(s.paid_bookings_count),
        gross_cents: Number(s.gross_cents),
        avg_rating: s.avg_rating == null ? null : Number(s.avg_rating),
        review_count: Number(s.review_count),
      };

      const reviewRows = await db`
        SELECT r.id, r.booking_id, r.customer_name, r.customer_email,
               r.rating, r.comment, r.created_at,
               sv.name AS service_name
        FROM arvo.reviews r
        LEFT JOIN arvo.services sv ON sv.id = r.service_id
        WHERE r.shop_id = ${shop.id}
        ORDER BY r.created_at DESC
      `;
      const reviews: AdminReviewRow[] = (reviewRows as Record<string, any>[]).map((r) => ({
        id: Number(r.id),
        booking_id: Number(r.booking_id),
        customer_name: r.customer_name,
        customer_email: r.customer_email,
        service_name: r.service_name == null ? null : r.service_name,
        rating: Number(r.rating),
        comment: r.comment,
        created_at:
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }));

      // Transactions for this business — reuse the ledger query scoped by slug.
      const txRows = await adminTransactionsQuery(db, {
        shopSlug: data.slug,
        limit: 500,
      });

      return { access: "ok", detail: { shop, transactions: txRows, reviews } };
    },
  );