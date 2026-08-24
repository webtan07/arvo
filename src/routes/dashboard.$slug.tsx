import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getDashboard, markBookingsSeen } from "~/db/server";
import type { BookingView } from "~/db/server";
import { formatCreated, formatDateTime, formatGBP } from "~/lib/format";

export const Route = createFileRoute("/dashboard/$slug")({
  component: DashboardPage,
  loader: async ({ params }) => {
    const dash = await getDashboard({ data: params.slug });
    return { dash };
  },
});

function DashboardPage() {
  const { dash: initial } = Route.useLoaderData();
  const [dash, setDash] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!dash.shop) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-lg font-semibold">Shop not found.</p>
        <p className="mt-2 text-sm text-ink-soft">
          Dashboards are addressed per shop, e.g.{" "}
          <code className="rounded bg-surface px-1">/dashboard/&lt;shop-slug&gt;</code>
        </p>
      </div>
    );
  }

  const unreadBookings = dash.bookings.filter((b) => b.status !== "cancelled" && !b.seen);

  async function refresh() {
    const next = await getDashboard({ data: dash.shop!.slug });
    setDash(next);
  }

  async function markAllRead() {
    const ids = unreadBookings.map((b) => b.id);
    if (!ids.length) return;
    setBusy(true);
    await markBookingsSeen({ data: ids });
    await refresh();
    setBusy(false);
  }

  const upcoming = dash.bookings.filter((b) => b.status !== "cancelled");

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Shop dashboard</p>
          <h1 className="font-display text-3xl font-extrabold">{dash.shop.name}</h1>
        </div>
        <Link to="/" className="text-sm font-semibold text-brand hover:underline">
          ← Directory
        </Link>
      </header>

      {/* Notifications */}
      <section className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">
            Notifications
            {dash.unread > 0 && (
              <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                {dash.unread} new
              </span>
            )}
          </h2>
          {unreadBookings.length > 0 && (
            <button
              className="text-sm font-semibold text-brand hover:underline"
              onClick={markAllRead}
              disabled={busy}
            >
              Mark all as read
            </button>
          )}
        </div>

        {unreadBookings.length === 0 ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            You're all caught up — no unread bookings.
          </p>
        ) : (
          <ul className="space-y-2">
            {unreadBookings.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
                  <div>
                    <p className="text-sm font-bold">
                      New booking — {b.serviceName || "Service"}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {b.customer_name} ·{" "}
                      {b.slotStartsAt ? formatDateTime(b.slotStartsAt) : "no slot"} ·{" "}
                      {b.payment_option === "pay_online"
                        ? b.paid
                          ? "Paid online"
                          : "Awaiting payment"
                        : "Pay on the day"}
                    </p>
                  </div>
                </div>
                {b.priceCents != null && (
                  <span className="shrink-0 text-sm font-extrabold text-brand">
                    {formatGBP(b.priceCents)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* All bookings */}
      <section className="card p-5">
        <h2 className="mb-4 font-display text-lg font-bold">
          Bookings{" "}
          <span className="text-sm font-normal text-ink-soft">({upcoming.length})</span>
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            No bookings yet. New bookings will appear here with a notification.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Payment</th>
                  <th className="py-2 pr-3">Booked</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id} className="border-b border-line last:border-0">
                    <td className="py-3 pr-3">
                      <p className="font-bold">{b.customer_name}</p>
                      <p className="text-xs text-ink-soft">{b.customer_email}</p>
                    </td>
                    <td className="py-3 pr-3">{b.serviceName || "—"}</td>
                    <td className="py-3 pr-3">
                      {b.slotStartsAt ? formatDateTime(b.slotStartsAt) : "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <PaymentBadge b={b} />
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

      {/* Availability note */}
      <section className="card mt-6 p-5 text-sm text-ink-soft">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Availability</h2>
        <p>
          The shop is open Monday–Saturday, 8am–5pm, with hourly slots. Availability
          is generated automatically and slots further than 3 hours away are
          bookable online. Bookings close 3 hours before each slot.
        </p>
      </section>
    </div>
  );
}

function PaymentBadge({ b }: { b: BookingView }) {
  if (b.payment_option === "pay_online") {
    return b.paid ? (
      <span className="chip bg-green-100 text-green-700">Paid online</span>
    ) : (
      <span className="chip bg-amber-100 text-amber-700">Awaiting payment</span>
    );
  }
  return <span className="chip bg-surface text-ink-soft">Pay on the day</span>;
}
