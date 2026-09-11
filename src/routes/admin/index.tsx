import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  getAdminBusinesses,
  getAdminCustomers,
  getAdminOverview,
  getAdminTransactions,
  logoutAdmin,
  type AdminBusinessRow,
  type AdminCustomerRow,
  type AdminOverview,
  type AdminTransactionRow,
} from "~/db/admin";
import { clearAdminToken, getAdminToken } from "~/lib/adminSession";
import { useAdminSession } from "~/lib/useAdminSession";
import { formatAUD, formatCreated } from "~/lib/format";
import { StatusPill, Stars } from "~/components/AdminBits";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

/**
 * Super-admin analytics dashboard (Phase B part 5). The Arvo owner
 * (superadmin) and the view-only analytics account (analytics_viewer) see the
 * SAME analytics — there is deliberately nothing editable on any admin page,
 * and no admin server function mutates data. Every section below is backed by
 * a SELECT-only server fn that rejects non-admin sessions server-side.
 */
function AdminDashboardPage() {
  const navigate = useNavigate();
  const session = useAdminSession();

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [businesses, setBusinesses] = useState<AdminBusinessRow[] | null>(null);
  const [customers, setCustomers] = useState<AdminCustomerRow[] | null>(null);
  const [transactions, setTransactions] = useState<AdminTransactionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transactions filters (server-scoped): status + optional from/to dates.
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ status: "", from: "", to: "" });

  const [loggingOut, setLoggingOut] = useState(false);

  // Guard: no admin session → /admin/login. Server fns re-check the token, so
  // this redirect is UX only; the data itself is never leaked.
  useEffect(() => {
    if (session.status === "guest") {
      navigate({ to: "/admin/login", replace: true });
    }
  }, [session, navigate]);

  async function loadAll() {
    const t = getAdminToken();
    if (!t) return;
    setLoading(true);
    setError(null);
    const [ov, biz, cust, tx] = await Promise.all([
      getAdminOverview({ data: { token: t } }),
      getAdminBusinesses({ data: { token: t } }),
      getAdminCustomers({ data: { token: t } }),
      getAdminTransactions({
        data: {
          token: t,
          status: applied.status || undefined,
          from: applied.from || undefined,
          to: applied.to || undefined,
        },
      }),
    ]);
    if (ov.access === "guest" || biz.access === "guest") {
      clearAdminToken();
      navigate({ to: "/admin/login", replace: true });
      return;
    }
    if (ov.overview) setOverview(ov.overview);
    setBusinesses(biz.rows);
    setCustomers(cust.access === "ok" ? cust.rows : []);
    setTransactions(tx.access === "ok" ? tx.rows : []);
    setLoading(false);
  }

  // Initial + filter-change load. Also refresh when the session resolves.
  useEffect(() => {
    if (session.status === "admin") {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, applied]);

  async function handleLogout() {
    setLoggingOut(true);
    const t = getAdminToken();
    if (t) await logoutAdmin({ data: t });
    clearAdminToken();
    navigate({ to: "/admin/login", replace: true });
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ status, from, to });
  }

  if (session.status !== "admin") {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 text-center text-ink-soft">
        Checking access…
      </div>
    );
  }

  const isSuper = session.role === "superadmin";
  const gross = overview?.grossEarningsCents ?? 0;
  const net = overview?.netCashAfterFeesCents ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      {/* Header: role badge + logout */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Arvo · analytics</p>
          <h1 className="font-display text-2xl font-extrabold">Platform overview</h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`chip ${
              isSuper ? "bg-brand/10 text-brand" : "bg-sky-100 text-sky-700"
            }`}
          >
            {isSuper ? "Super Admin" : "View-only"}
          </span>
          <span className="text-sm text-ink-soft">{session.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn-outline px-3 py-1.5 text-sm"
          >
            {loggingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      </div>

      {loading && !overview ? (
        <p className="mt-8 text-center text-sm text-ink-soft">Loading analytics…</p>
      ) : (
        <>
          {/* Overview cards — "overall earnings" is the headline. */}
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Gross earnings (paid)
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold text-brand">
                {formatAUD(gross)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {overview?.paidTransactions ?? 0} paid transactions · money that
                actually moved
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Net cash after fees
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {formatAUD(net)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Paid totals minus Stripe fees — what the businesses keep
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Active credits
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {formatAUD(overview?.activeCreditsCents ?? 0)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {overview?.activeCreditsCount ?? 0} outstanding customer credits
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Average rating
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {overview?.avgRating == null ? "—" : overview.avgRating.toFixed(1)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                <Stars rating={overview?.avgRating ?? null} />{" "}
                {overview?.reviewCount ?? 0} reviews
              </p>
            </div>
          </section>

          {/* Secondary stats row */}
          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Total bookings
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {overview?.totalBookings ?? 0}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {overview?.completedBookings ?? 0} completed
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Active businesses
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {overview?.activeBusinesses ?? 0}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {overview?.registeredBusinesses ?? 0} registered in total
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Total customers
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {overview?.totalCustomers ?? 0}
              </p>
              <p className="mt-1 text-xs text-ink-soft">Accounts + guest bookers</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Gross per paid booking
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold">
                {overview && overview.paidTransactions > 0
                  ? formatAUD(Math.round(gross / overview.paidTransactions))
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-soft">Average across the ledger</p>
            </div>
          </section>

          {error && (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
              {error}
            </p>
          )}

          {/* Businesses table */}
          <section className="card mt-6 p-5">
            <h2 className="mb-1 font-display text-lg font-bold">Mobile businesses</h2>
            <p className="mb-4 text-xs text-ink-soft">
              Bookings, gross earnings and reviews per business. Click a business
              for its full drill-down.
            </p>
            {businesses && businesses.length === 0 ? (
              <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
                No businesses registered yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                      <th className="py-2 pr-3">Business</th>
                      <th className="py-2 pr-3">Bookings</th>
                      <th className="py-2 pr-3">Paid</th>
                      <th className="py-2 pr-3">Gross earnings</th>
                      <th className="py-2 pr-3">Rating</th>
                      <th className="py-2 pr-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(businesses ?? []).map((b) => (
                      <tr key={b.id} className="border-b border-line last:border-0">
                        <td className="py-3 pr-3">
                          <Link
                            to="/admin/businesses/$slug"
                            params={{ slug: b.slug }}
                            className="font-bold text-brand hover:underline"
                          >
                            {b.name}
                          </Link>
                          <p className="text-xs text-ink-soft">/{b.slug}</p>
                        </td>
                        <td className="py-3 pr-3">{b.bookings_count}</td>
                        <td className="py-3 pr-3">{b.paid_bookings_count}</td>
                        <td className="py-3 pr-3 font-semibold">
                          {formatAUD(b.gross_cents)}
                        </td>
                        <td className="py-3 pr-3">
                          <Stars rating={b.avg_rating} />{" "}
                          <span className="text-xs text-ink-soft">
                            ({b.review_count})
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-xs text-ink-soft">
                          {formatCreated(b.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Customers table */}
          <section className="card mt-6 p-5">
            <h2 className="mb-4 font-display text-lg font-bold">Customers</h2>
            {customers && customers.length === 0 ? (
              <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
                No customers yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                      <th className="py-2 pr-3">Customer</th>
                      <th className="py-2 pr-3">Bookings</th>
                      <th className="py-2 pr-3">Total spend</th>
                      <th className="py-2 pr-3">Credit balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(customers ?? []).map((c) => (
                      <tr key={c.email} className="border-b border-line last:border-0">
                        <td className="py-3 pr-3">
                          <p className="font-bold">{c.name || "Guest"}</p>
                          <p className="text-xs text-ink-soft">{c.email}</p>
                        </td>
                        <td className="py-3 pr-3">{c.bookings_count}</td>
                        <td className="py-3 pr-3 font-semibold">
                          {formatAUD(c.total_spend_cents)}
                        </td>
                        <td className="py-3 pr-3">
                          {c.available_credit_cents > 0 ? (
                            <span className="chip bg-emerald-100 text-emerald-700">
                              {formatAUD(c.available_credit_cents)}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-soft">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Transactions table */}
          <section className="card mt-6 p-5">
            <h2 className="mb-1 font-display text-lg font-bold">Transactions</h2>
            <p className="mb-3 text-xs text-ink-soft">
              Every ledger row — the money lifecycle across all businesses.
              Showing the most recent 500; use the filters to narrow.
            </p>

            <form onSubmit={applyFilters} className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">
                  Status
                </label>
                <select
                  className="input py-2"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="credited">Credited</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">
                  From
                </label>
                <input
                  className="input py-2"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">
                  To
                </label>
                <input
                  className="input py-2"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <button className="btn px-4 py-2" type="submit" disabled={loading}>
                {loading ? "Loading…" : "Apply filters"}
              </button>
              {(applied.status || applied.from || applied.to) && (
                <button
                  type="button"
                  className="btn-outline px-4 py-2 text-sm"
                  onClick={() => {
                    setStatus("");
                    setFrom("");
                    setTo("");
                    setApplied({ status: "", from: "", to: "" });
                  }}
                >
                  Clear
                </button>
              )}
            </form>

            {transactions && transactions.length === 0 ? (
              <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
                No transactions match.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                      <th className="py-2 pr-3">Booking</th>
                      <th className="py-2 pr-3">Business</th>
                      <th className="py-2 pr-3">Service</th>
                      <th className="py-2 pr-3">Customer</th>
                      <th className="py-2 pr-3 text-right">Service</th>
                      <th className="py-2 pr-3 text-right">Fee</th>
                      <th className="py-2 pr-3 text-right">Credit</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Paid / completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(transactions ?? []).map((t) => (
                      <tr key={t.booking_id} className="border-b border-line last:border-0">
                        <td className="py-3 pr-3">
                          <span className="font-bold">{t.reference}</span>
                          <p className="text-xs text-ink-soft">
                            {formatCreated(t.created_at)}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <Link
                            to="/admin/businesses/$slug"
                            params={{ slug: t.business_slug }}
                            className="font-semibold text-brand hover:underline"
                          >
                            {t.business_name}
                          </Link>
                        </td>
                        <td className="py-3 pr-3">{t.service_name || "—"}</td>
                        <td className="py-3 pr-3">
                          <p className="font-semibold">{t.customer_name}</p>
                          <p className="text-xs text-ink-soft">{t.customer_email}</p>
                        </td>
                        <td className="py-3 pr-3 text-right">{formatAUD(t.service_cents)}</td>
                        <td className="py-3 pr-3 text-right text-ink-soft">
                          {formatAUD(t.fee_cents)}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          {t.credit_applied_cents > 0 ? (
                            <span className="text-emerald-600">
                              −{formatAUD(t.credit_applied_cents)}
                            </span>
                          ) : (
                            <span className="text-ink-soft">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-right font-extrabold">
                          {formatAUD(t.total_cents)}
                        </td>
                        <td className="py-3 pr-3">
                          <StatusPill status={t.transaction_status} />
                        </td>
                        <td className="py-3 pr-3 text-xs text-ink-soft">
                          {t.paid_at ? `Paid ${formatCreated(t.paid_at)}` : "—"}
                          {t.completed_at && (
                            <span className="block">Completed {formatCreated(t.completed_at)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* View-only notice */}
          <p className="mt-4 text-center text-xs text-ink-soft">
            Analytics is view-only — admin accounts cannot modify bookings,
            transactions or accounts.
          </p>
        </>
      )}
    </div>
  );
}