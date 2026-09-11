import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getSessionUser, logout } from "~/db/auth";
import { getMyBookings, getCustomerCredits, getCompletionPhoto } from "~/db/server";
import type { BookingView, CustomerCreditsResult } from "~/db/server";
import type { SessionUser } from "~/db/auth";
import { clearSessionToken, getSessionToken } from "~/lib/session";
import { formatDateTime, formatAUD, formatCreated } from "~/lib/format";
import CancellationAction from "~/components/CancellationAction";

export const Route = createFileRoute("/account")({
  component: AccountPage,
});

function AccountPage() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = loading
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [credits, setCredits] = useState<CustomerCreditsResult | null>(null);
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
      const [my, creditRes] = await Promise.all([
        getMyBookings({ data: token }),
        getCustomerCredits({ data: { token } }),
      ]);
      if (active) {
        setBookings(my);
        setCredits(creditRes);
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
    setCredits(null);
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
          Sign in to see your upcoming and past bookings, your credit balance,
          and speed up future bookings with your saved details.
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
            ← Browse services
          </Link>
        </p>
      </div>
    );
  }

  const now = Date.now();
  const ACTIVE = ["pending", "awaiting_payment", "confirmed", "rescheduled"];
  const pendingDecision = bookings.filter((b) => b.status === "cancellation_pending");
  const upcoming = bookings.filter(
    (b) =>
      ACTIVE.includes(b.status) &&
      b.slotStartsAt &&
      new Date(b.slotStartsAt).getTime() >= now,
  );
  const past = bookings.filter(
    (b) => !pendingDecision.includes(b) && !upcoming.includes(b),
  );

  const activeCents = credits?.ok ? credits.totals.activeCents : 0;
  const creditList = credits?.ok ? credits.credits : [];

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

      {/* Credit balance */}
      {loaded && creditList.length > 0 && (
        <section className="card mb-8 p-5">
          <h2 className="font-display text-lg font-bold">Your credit</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Credit is issued when the mobile business cancels a paid booking and
            you choose cancel-for-credit — it's applied at checkout (tick the box),
            and unused credit expires.
          </p>
          {activeCents > 0 ? (
            <p className="mt-3 font-display text-2xl font-extrabold text-brand">
              {formatAUD(activeCents)} available
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">No usable credit right now.</p>
          )}
          <ul className="mt-4 space-y-2">
            {creditList.map((c) => {
              const expired = c.effectiveStatus === "expired";
              const used = c.effectiveStatus === "used";
              return (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm ${
                    expired || used ? "bg-surface text-ink-soft" : "bg-brand/5"
                  }`}
                >
                  <span>
                    <span className="font-bold">{formatAUD(c.amount_cents)}</span>
                    {!used && (
                      <span className="text-xs text-ink-soft">
                        {" "}
                        · expires{" "}
                        {new Date(c.expires_at).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </span>
                  <span className="chip shrink-0">
                    {expired ? "Expired" : used ? "Used" : "Active"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
            Browse services
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Cancelled by the business — the customer must choose */}
          {pendingDecision.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg font-bold">
                Cancelled by the business — your choice{" "}
                <span className="text-sm font-normal text-ink-soft">
                  ({pendingDecision.length})
                </span>
              </h2>
              <div className="grid gap-4">
                {pendingDecision.map((b) => (
                  <div key={b.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-brand">
                          Reference ARVO-{String(b.id).padStart(4, "0")}
                        </p>
                        <h3 className="mt-1 font-display text-lg font-extrabold">
                          {b.shopName}
                        </h3>
                        <p className="text-sm text-ink-soft">
                          {b.serviceName || "Service"}
                          {b.slotStartsAt ? (
                            <>
                              {" · was "}
                              <span className="font-semibold text-ink">
                                {formatDateTime(b.slotStartsAt)}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span className="chip bg-amber-100 text-amber-700">
                        Needs your decision
                      </span>
                    </div>
                    <div className="mt-4">
                      <CancellationAction
                        bookingId={b.id}
                        token={getSessionToken() ?? undefined}
                        onResolved={() => {
                          // Refresh the list so the resolved booking moves out.
                          const t = getSessionToken();
                          if (t) {
                            getMyBookings({ data: t }).then(setBookings);
                            getCustomerCredits({ data: { token: t } }).then(setCredits);
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
          {b.credit_applied_cents > 0 && (
            <p className="mt-0.5 text-xs font-semibold text-brand">
              Credit applied: {formatAUD(b.credit_applied_cents)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge b={b} cancelled={cancelled} />
          {!cancelled && <PaymentBadge b={b} />}
          <ReminderBadge b={b} />
        </div>
      </div>
      {/* Completed bookings: serviced-vehicle photo + review link (Phase B parts 3–4). */}
      {b.status === "completed" && <CompletedReviewSection b={b} />}
    </div>
  );
}

/**
 * For a completed booking: the photo of the serviced vehicle (fetched on demand
 * via getCompletionPhoto — the data URL is excluded from booking list payloads)
 * and the review entry point: "Leave a review" until the customer has reviewed,
 * then "Your review" (the /review/<id> page shows their stored review).
 */
function CompletedReviewSection({ b }: { b: BookingView }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const token = getSessionToken();
    if (!token) return;
    getCompletionPhoto({ data: { token, bookingId: b.id } })
      .then((res) => {
        if (active && res.ok && res.photoUrl) setPhotoUrl(res.photoUrl);
      })
      .catch(() => {
        // Non-fatal: the photo simply doesn't render.
      });
    return () => {
      active = false;
    };
  }, [b.id]);

  return (
    <div className="mt-4 border-t border-line pt-4">
      {b.completed_at && (
        <p className="text-xs text-ink-soft">
          Completed {formatCreated(b.completed_at)}
        </p>
      )}
      {photoUrl && (
        <img
          src={photoUrl}
          alt="Your serviced vehicle"
          className="mt-2 max-h-60 rounded-xl border border-line object-contain"
        />
      )}
      <div className="mt-3">
        <Link
          to="/review/$id"
          params={{ id: String(b.id) }}
          className={`btn ${b.reviewed ? "btn-outline" : ""}`}
        >
          {b.reviewed ? "Your review" : "Leave a review"}
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ b, cancelled }: { b: BookingView; cancelled: boolean }) {
  if (cancelled) return <span className="chip bg-surface text-ink-soft">Cancelled</span>;
  if (b.status === "confirmed") return <span className="chip bg-green-100 text-green-700">Confirmed</span>;
  if (b.status === "rescheduled") return <span className="chip bg-green-100 text-green-700">Rescheduled</span>;
  if (b.status === "completed") return <span className="chip bg-green-100 text-green-700">Completed</span>;
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