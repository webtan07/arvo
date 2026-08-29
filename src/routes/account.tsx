import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getSessionUser, logout } from "~/db/auth";
import { getMyBookings } from "~/db/server";
import type { BookingView } from "~/db/server";
import type { SessionUser } from "~/db/auth";
import { clearSessionToken, getSessionToken } from "~/lib/session";
import { formatDateTime, formatAUD } from "~/lib/format";

export const Route = createFileRoute("/account")({
  component: AccountPage,
});

function AccountPage() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = loading
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = getSessionToken();
      if (!token) {
        if (active) setUser(null);
        return;
      }
      const sessionUser = await getSessionUser({ data: token });
      if (!active) return;
      if (!sessionUser) {
        // Stale/expired session — drop it and show the guest state.
        clearSessionToken();
        setUser(null);
        return;
      }
      setUser(sessionUser);
      const my = await getMyBookings({ data: token });
      if (active) {
        setBookings(my);
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    const token = getSessionToken();
    if (token) {
      try {
        await logout({ data: token });
      } catch {
        // Non-fatal — still clear the local session below.
      }
    }
    clearSessionToken();
    setUser(null);
    setBookings([]);
  }

  // undefined = auth check still in flight
  if (user === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">Loading your account…</div>
    );
  }

  // No valid session → friendly guest state (never crash).
  if (user === null) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">My Bookings</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          Sign in to see your upcoming and past bookings, manage them, and speed
          up future bookings with your saved details.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/login" className="btn">
            Log in
          </Link>
          <Link to="/register" className="btn-outline">
            Create an account
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

  const now = Date.now();
  const upcoming = bookings.filter(
    (b) => b.status !== "cancelled" && b.slotStartsAt && new Date(b.slotStartsAt).getTime() >= now,
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">My Bookings</h1>
          <p className="text-sm text-ink-soft">
            {user.name ? `Hi ${user.name} · ` : ""}
            {user.email}
          </p>
        </div>
        <button className="btn-outline" onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      {!loaded ? (
        <p className="rounded-xl bg-surface p-6 text-center text-ink-soft">
          Loading your bookings…
        </p>
      ) : bookings.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold">No bookings yet</p>
          <p className="mt-2 text-sm text-ink-soft">
            When you book a detailer while signed in, your future and past
            bookings will show up here.
          </p>
          <Link to="/" className="btn mt-5">
            Browse shops
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 font-display text-lg font-bold">
              Upcoming{" "}
              <span className="text-sm font-normal text-ink-soft">({upcoming.length})</span>
            </h2>
            {upcoming.length === 0 ? (
              <p className="rounded-xl bg-surface p-4 text-sm text-ink-soft">
                Nothing booked ahead — time to find a detailer.
              </p>
            ) : (
              <div className="grid gap-3">
                {upcoming.map((b) => (
                  <BookingCard key={b.id} b={b} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-bold">
              Past{" "}
              <span className="text-sm font-normal text-ink-soft">({past.length})</span>
            </h2>
            {past.length === 0 ? (
              <p className="rounded-xl bg-surface p-4 text-sm text-ink-soft">
                Your past bookings will appear here.
              </p>
            ) : (
              <div className="grid gap-3">
                {past.map((b) => (
                  <BookingCard key={b.id} b={b} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function BookingCard({ b }: { b: BookingView }) {
  const cancelled = b.status === "cancelled";
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand">
            Reference ARVO-{String(b.id).padStart(4, "0")}
          </p>
          <h3 className="mt-1 font-display text-lg font-extrabold">{b.shopName}</h3>
          <p className="text-sm text-ink-soft">
            {b.serviceName || "Service"}
            {b.slotStartsAt ? (
              <>
                {" · "}
                <span className="font-semibold text-ink">{formatDateTime(b.slotStartsAt)}</span>
              </>
            ) : null}
          </p>
          {b.priceCents != null && (
            <p className="mt-1 text-sm font-bold text-ink">{formatAUD(b.priceCents)}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge b={b} cancelled={cancelled} />
          {!cancelled && <PaymentBadge b={b} />}
          <ReminderBadge b={b} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ b, cancelled }: { b: BookingView; cancelled: boolean }) {
  if (cancelled) return <span className="chip bg-surface text-ink-soft">Cancelled</span>;
  if (b.status === "confirmed") return <span className="chip bg-green-100 text-green-700">Confirmed</span>;
  if (b.status === "awaiting_payment") return <span className="chip bg-amber-100 text-amber-700">Awaiting payment</span>;
  return <span className="chip bg-surface text-ink-soft">{b.status}</span>;
}

function PaymentBadge({ b }: { b: BookingView }) {
  if (b.payment_option !== "pay_online") return null;
  return b.paid ? (
    <span className="chip bg-green-100 text-green-700">Paid</span>
  ) : (
    <span className="chip bg-amber-100 text-amber-700">Unpaid</span>
  );
}

function ReminderBadge({ b }: { b: BookingView }) {
  // Confirmation-email reminder status — sent once email_sent_at is stamped.
  return b.email_sent_at ? (
    <span className="chip bg-green-100 text-green-700">✓ Email sent</span>
  ) : (
    <span className="chip bg-surface text-ink-soft">Email pending</span>
  );
}
