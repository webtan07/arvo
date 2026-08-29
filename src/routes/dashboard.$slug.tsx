import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getOwnerDashboard, markBookingsSeen } from "~/db/server";
import type { BookingView, DashboardData } from "~/db/server";
import { logout } from "~/db/auth";
import { formatCreated, formatDateTime, formatAUD } from "~/lib/format";
import { clearSessionToken, getSessionToken } from "~/lib/session";

export const Route = createFileRoute("/dashboard/$slug")({
  component: DashboardPage,
});

type Access = "loading" | "guest" | "denied" | "ok";

function DashboardPage() {
  const { slug } = Route.useParams();
  const [access, setAccess] = useState<Access>("loading");
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = getSessionToken();
      if (!token) {
        if (active) setAccess("guest");
        return;
      }
      const res = await getOwnerDashboard({ data: { token, slug } });
      if (!active) return;
      if (res.access === "ok") {
        setDash(res.dash ?? { shop: null, bookings: [], unread: 0 });
        setAccess("ok");
      } else if (res.access === "guest") {
        clearSessionToken();
        setAccess("guest");
      } else {
        setAccess("denied");
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (access === "loading") {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 text-center text-ink-soft">
        Checking shop access…
      </div>
    );
  }

  // No (or expired) owner session → clear "shop owner login" prompt.
  if (access === "guest") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-xs uppercase tracking-wide text-ink-soft">Shop dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Owner login required</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          This dashboard shows a shop's bookings and notifications. Sign in with
          the shop owner account to continue.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/owner/login" className="btn">
            Shop owner login
          </Link>
          <Link to="/owner/register" className="btn-outline">
            Register your shop
          </Link>
        </div>
        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/" className="text-brand hover:text-brand-dark">
            ← Browse shops
          </Link>
        </p>
      </div>
    );
  }

  // Signed in but not an owner (or owner of a different shop) → access denied.
  if (access === "denied") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">Access denied</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          Your account doesn't have permission to view this shop's dashboard.
          Sign in with the shop owner account that owns this shop.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/owner/login" className="btn">
            Sign in as owner
          </Link>
          <ButtonSignOut onDone={() => setAccess("guest")} />
        </div>
        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/" className="text-brand hover:text-brand-dark">
            ← Browse shops
          </Link>
        </p>
      </div>
    );
  }

  // Authorized — render the shop dashboard.
  const d = dash!;
  if (!d.shop) {
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

  const unreadBookings = d.bookings.filter((b) => b.status !== "cancelled" && !b.seen);

  async function refresh() {
    const token = getSessionToken();
    if (!token) return;
    const res = await getOwnerDashboard({ data: { token, slug } });
    if (res.access === "ok" && res.dash) setDash(res.dash);
  }

  async function markAllRead() {
    const ids = unreadBookings.map((b) => b.id);
    if (!ids.length) return;
    setBusy(true);
    await markBookingsSeen({ data: ids });
    await refresh();
    setBusy(false);
  }

  const upcoming = d.bookings.filter((b) => b.status !== "cancelled");

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Shop dashboard</p>
          <h1 className="font-display text-3xl font-extrabold">{d.shop.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-sm font-semibold text-brand hover:underline">
            ← Directory
          </Link>
          <ButtonSignOut onDone={() => setAccess("guest")} />
        </div>
      </header>

      {/* Notifications */}
      <section className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">
            Notifications
            {d.unread > 0 && (
              <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                {d.unread} new
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
                    {formatAUD(b.priceCents)}
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
          Bookable slots are generated automatically from the schedule you set at
          registration, and slots further than 3 hours away are bookable online.
          Bookings close 3 hours before each slot.
        </p>
      </section>
    </div>
  );
}

function ButtonSignOut({ onDone }: { onDone: () => void }) {
  return (
    <button
      type="button"
      className="btn-outline"
      onClick={async () => {
        const token = getSessionToken();
        if (token) {
          try {
            await logout({ data: token });
          } catch {
            // Non-fatal — still clear the local session.
          }
        }
        clearSessionToken();
        onDone();
      }}
    >
      Sign out
    </button>
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
