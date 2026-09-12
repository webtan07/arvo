import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  getAdminBusiness,
  type AdminBusinessDetail,
  type AdminTransactionRow,
} from "~/db/admin";
import { clearAdminToken, getAdminToken } from "~/lib/adminSession";
import { useAdminSession } from "~/lib/useAdminSession";
import { formatAUD, formatCreated } from "~/lib/format";
import { StatusPill, Stars } from "~/components/AdminBits";

export const Route = createFileRoute("/admin/businesses/$slug")({
  component: AdminBusinessPage,
});

/** Per-business drill-down: that business's bookings + transactions + reviews. */
function AdminBusinessPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const session = useAdminSession();
  const [detail, setDetail] = useState<AdminBusinessDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session.status === "guest") {
      navigate({ to: "/admin/login", replace: true });
      return;
    }
    if (session.status !== "admin") return;
    let active = true;
    (async () => {
      const t = getAdminToken();
      if (!t) return;
      const res = await getAdminBusiness({ data: { token: t, slug } });
      if (!active) return;
      if (res.access === "guest") {
        clearAdminToken();
        navigate({ to: "/admin/login", replace: true });
        return;
      }
      if (!res.detail) setNotFound(true);
      else setDetail(res.detail);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, slug]);

  if (session.status === "admin" && loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16 text-center text-ink-soft">
        Loading business…
      </div>
    );
  }
  if (notFound || !detail) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">Business not found</h1>
        <p className="mt-3 text-ink-soft">No mobile business matches this address.</p>
        <div className="mt-6">
          <Link to="/admin" className="btn">
            ← Back to analytics
          </Link>
        </div>
      </div>
    );
  }

  const { shop, transactions, reviews } = detail;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Arvo · analytics</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">{shop.name}</h1>
          <p className="text-sm text-ink-soft">
            /{shop.slug} · registered {formatCreated(shop.created_at)}
          </p>
        </div>
        <Link to="/admin" className="btn-outline px-3 py-1.5 text-sm">
          ← All businesses
        </Link>
      </div>

      {/* Business stat cards */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Bookings
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold">
            {shop.bookings_count}
          </p>
          <p className="mt-1 text-xs text-ink-soft">{shop.paid_bookings_count} paid</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Gross earnings (paid)
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold text-brand">
            {formatAUD(shop.gross_cents)}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Money that actually moved</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Average rating
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold">
            {shop.avg_rating == null ? "—" : shop.avg_rating.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            <Stars rating={shop.avg_rating} /> {shop.review_count} reviews
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Gross per paid booking
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold">
            {shop.paid_bookings_count > 0
              ? formatAUD(Math.round(shop.gross_cents / shop.paid_bookings_count))
              : "—"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Average across the ledger</p>
        </div>
      </section>

      {/* Transactions for this business */}
      <section className="card mt-6 p-5">
        <h2 className="mb-1 font-display text-lg font-bold">Transactions</h2>
        <p className="mb-4 text-xs text-ink-soft">
          All ledger rows for this business (most recent 500).
        </p>
        {transactions.length === 0 ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            No transactions yet.
          </p>
        ) : (
          <TransactionTable rows={transactions} />
        )}
      </section>

      {/* Reviews for this business */}
      <section className="card mt-6 p-5">
        <h2 className="mb-1 font-display text-lg font-bold">Reviews</h2>
        <p className="mb-4 text-xs text-ink-soft">
          Customer reviews left for this business's completed services.
        </p>
        {reviews.length === 0 ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            No reviews yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">
                    {r.customer_name} · {r.service_name || "Service"}
                  </p>
                  <p className="text-xs text-ink-soft">{formatCreated(r.created_at)}</p>
                </div>
                <p className="mt-1">
                  <Stars rating={r.rating} />
                </p>
                <p className="mt-2 text-sm text-ink">{r.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TransactionTable({ rows }: { rows: AdminTransactionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
            <th className="py-2 pr-3">Booking</th>
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
          {rows.map((t) => (
            <tr key={t.booking_id} className="border-b border-line last:border-0">
              <td className="py-3 pr-3">
                <span className="font-bold">{t.reference}</span>
                <p className="text-xs text-ink-soft">{formatCreated(t.created_at)}</p>
              </td>
              <td className="py-3 pr-3">{t.service_name || "—"}</td>
              <td className="py-3 pr-3">
                <p className="font-semibold">{t.customer_name}</p>
                <p className="text-xs text-ink-soft">{t.customer_email}</p>
              </td>
              <td className="py-3 pr-3 text-right">{formatAUD(t.service_cents)}</td>
              <td className="py-3 pr-3 text-right text-ink-soft">{formatAUD(t.fee_cents)}</td>
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
  );
}
