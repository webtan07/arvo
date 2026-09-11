import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  getOwnerDashboard,
  markBookingsSeen,
  cancelBookingByOwner,
  completeBookingByOwner,
  getOwnerTransactions,
  getCompletionPhoto,
} from "~/db/server";
import type { BookingView, DashboardData, OwnerTransactionRow } from "~/db/server";
import {
  COMPLETION_PHOTO_ACCEPT,
  COMPLETION_PHOTO_MAX_BYTES,
  COMPLETION_PHOTO_MAX_EDGE,
} from "~/lib/images";
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

  // Owner cancellation state: the booking awaiting confirmation + busy flag.
  const [cancelTarget, setCancelTarget] = useState<BookingView | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  // Service completion state: the booking being completed + the required photo.
  const [completeTarget, setCompleteTarget] = useState<BookingView | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeErr, setCompleteErr] = useState<string | null>(null);

  // Transaction history (ledger-backed, Phase B part 3).
  const [history, setHistory] = useState<OwnerTransactionRow[] | null>(null);

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
        const txs = await getOwnerTransactions({ data: { token, slug } });
        if (active && txs.access === "ok") setHistory(txs.rows);
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
        Checking access…
      </div>
    );
  }

  // No (or expired) owner session → clear "shop owner login" prompt.
  if (access === "guest") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-xs uppercase tracking-wide text-ink-soft">Service dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Owner login required</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          This dashboard shows your mobile business's bookings and notifications. Sign in with
          the mobile business account to continue.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/owner/login" className="btn">
            Mobile business login
          </Link>
          <Link to="/owner/register" className="btn-outline">
            Register your business
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

  // Signed in but not an owner (or owner of a different shop) → access denied.
  if (access === "denied") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">Access denied</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          Your account doesn't have permission to view this business's dashboard.
          Sign in with the mobile business account that owns it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/owner/login" className="btn">
            Sign in as owner
          </Link>
          <ButtonSignOut onDone={() => setAccess("guest")} />
        </div>
        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/" className="text-brand hover:text-brand-dark">
            ← Browse services
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
        <p className="text-lg font-semibold">Business not found.</p>
        <p className="mt-2 text-sm text-ink-soft">
          Dashboards are addressed per business, e.g.{" "}
          <code className="rounded bg-surface px-1">/dashboard/&lt;shop-slug&gt;</code>
        </p>
      </div>
    );
  }

  const unreadBookings = d.bookings.filter(
    (b) => !["cancelled", "cancellation_pending"].includes(b.status) && !b.seen,
  );

  async function refresh() {
    const token = getSessionToken();
    if (!token) return;
    const res = await getOwnerDashboard({ data: { token, slug } });
    if (res.access === "ok" && res.dash) setDash(res.dash);
    const txs = await getOwnerTransactions({ data: { token, slug } });
    if (txs.access === "ok") setHistory(txs.rows);
  }

  async function markAllRead() {
    const ids = unreadBookings.map((b) => b.id);
    if (!ids.length) return;
    setBusy(true);
    await markBookingsSeen({ data: ids });
    await refresh();
    setBusy(false);
  }

  // Active bookings only — 'cancellation_pending' (awaiting the customer's
  // choice), 'cancelled' and 'completed' are shown in their own sections below.
  const ACTIVE = ["pending", "awaiting_payment", "confirmed", "rescheduled"];
  const upcoming = d.bookings.filter((b) => ACTIVE.includes(b.status));
  const awaitingDecision = d.bookings.filter((b) => b.status === "cancellation_pending");
  const cancelled = d.bookings.filter((b) => b.status === "cancelled");
  const completed = d.bookings.filter((b) => b.status === "completed");

  async function confirmCancelBooking(b: BookingView) {
    const token = getSessionToken();
    if (!token || !b) return;
    setCancelling(true);
    setCancelErr(null);
    const res = await cancelBookingByOwner({ data: { token, bookingId: b.id, slug } });
    setCancelling(false);
    if (!res.ok || !res.booking) {
      setCancelErr(res.error || "Couldn't cancel this booking. Please try again.");
      return;
    }
    setCancelTarget(null);
    await refresh();
  }

  async function confirmCompleteBooking(b: BookingView, photoUrl: string) {
    const token = getSessionToken();
    if (!token || !b) return;
    setCompleting(true);
    setCompleteErr(null);
    const res = await completeBookingByOwner({ data: { token, slug, bookingId: b.id, photoUrl } });
    setCompleting(false);
    if (!res.ok || !res.booking) {
      setCompleteErr(res.error || "Couldn't complete this booking. Please try again.");
      return;
    }
    setCompleteTarget(null);
    await refresh();
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Service dashboard</p>
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
                  <th className="py-2 pr-3"></th>
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
                    <td className="py-3 pr-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {["confirmed", "rescheduled"].includes(b.status) && (
                          <button
                            type="button"
                            className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-green-700"
                            onClick={() => {
                              setCompleteErr(null);
                              setCompleteTarget(b);
                            }}
                          >
                            Complete
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-600 transition hover:border-red-400 hover:bg-red-50"
                          onClick={() => {
                            setCancelErr(null);
                            setCancelTarget(b);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Owner cancellation — confirmation step (states what the customer is offered) */}
        {cancelTarget && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-bold text-red-700">
              Cancel booking ARVO-{String(cancelTarget.id).padStart(4, "0")}?
            </p>
            <p className="mt-1 text-sm text-red-800">
              {cancelTarget.customer_name} · {cancelTarget.serviceName || "Service"}
              {cancelTarget.slotStartsAt ? ` · ${formatDateTime(cancelTarget.slotStartsAt)}` : ""}
            </p>
            <p className="mt-2 text-sm text-red-800">
              The customer will be emailed immediately and offered{" "}
              <b>two options: reschedule to a new time (payment carried over)</b>{" "}
              or <b>cancel for credit</b> (the amount paid becomes a 90-day credit
              balance — no card refund).
            </p>
            {cancelErr && <p className="mt-2 text-sm font-semibold text-red-700">{cancelErr}</p>}
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                disabled={cancelling}
                onClick={() => confirmCancelBooking(cancelTarget)}
              >
                {cancelling ? "Cancelling…" : "Yes, cancel this booking"}
              </button>
              <button
                type="button"
                className="btn-outline"
                disabled={cancelling}
                onClick={() => {
                  setCancelTarget(null);
                  setCancelErr(null);
                }}
              >
                Keep booking
              </button>
            </div>
          </div>
        )}

        {/* Service completion — required photo of the serviced vehicle */}
        {completeTarget && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="font-bold text-green-800">
              Complete booking ARVO-{String(completeTarget.id).padStart(4, "0")}?
            </p>
            <p className="mt-1 text-sm text-green-900">
              {completeTarget.customer_name} · {completeTarget.serviceName || "Service"}
              {completeTarget.slotStartsAt ? ` · ${formatDateTime(completeTarget.slotStartsAt)}` : ""}
            </p>
            <p className="mt-2 text-sm text-green-900">
              The customer will be emailed that their service is complete, along
              with a <b>photo of the serviced vehicle</b> and a review link.{" "}
              <b>A photo is required</b> to complete the booking.
            </p>
            <CompletionPhotoPicker
              busy={completing}
              onConfirm={(photoUrl) => confirmCompleteBooking(completeTarget, photoUrl)}
              onCancel={() => {
                setCompleteTarget(null);
                setCompleteErr(null);
              }}
            />
            {completeErr && (
              <p className="mt-2 text-sm font-semibold text-red-700">{completeErr}</p>
            )}
          </div>
        )}
      </section>

      {/* Cancelled by the owner — customer is deciding */}
      {awaitingDecision.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="mb-3 font-display text-lg font-bold">
            Awaiting customer decision{" "}
            <span className="text-sm font-normal text-ink-soft">({awaitingDecision.length})</span>
          </h2>
          <p className="mb-3 text-sm text-ink-soft">
            You cancelled these bookings — the customer was emailed the choice to
            reschedule or take credit, and can also choose from their account page.
          </p>
          <ul className="space-y-2">
            {awaitingDecision.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"
              >
                <div>
                  <p className="font-bold">
                    {b.serviceName || "Service"} · ARVO-{String(b.id).padStart(4, "0")}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {b.customer_name} · {b.slotStartsAt ? formatDateTime(b.slotStartsAt) : "—"}
                    {b.cancelled_at ? ` · cancelled ${formatCreated(b.cancelled_at)}` : ""}
                  </p>
                </div>
                <span className="chip bg-amber-100 text-amber-700">
                  Customer choosing
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cancelled (resolved: customer took credit) */}
      {cancelled.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="mb-3 font-display text-lg font-bold">
            Cancelled{" "}
            <span className="text-sm font-normal text-ink-soft">({cancelled.length})</span>
          </h2>
          <ul className="space-y-2">
            {cancelled.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm"
              >
                <div>
                  <p className="font-bold">
                    {b.serviceName || "Service"} · ARVO-{String(b.id).padStart(4, "0")}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {b.customer_name}
                    {b.cancelled_at ? ` · cancelled ${formatCreated(b.cancelled_at)}` : ""}
                    {b.priceCents != null ? ` · ${formatAUD(b.priceCents)} paid → credit` : ""}
                  </p>
                </div>
                <span className="chip bg-surface text-ink-soft">Cancelled</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Completed — the customer was emailed the photo + review link */}
      {completed.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="mb-3 font-display text-lg font-bold">
            Completed{" "}
            <span className="text-sm font-normal text-ink-soft">({completed.length})</span>
          </h2>
          <ul className="space-y-2">
            {completed.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <CompletionThumb bookingId={b.id} />
                  <div>
                    <p className="font-bold">
                      {b.serviceName || "Service"} · ARVO-{String(b.id).padStart(4, "0")}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {b.customer_name}
                      {b.completed_at ? ` · completed ${formatCreated(b.completed_at)}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="chip bg-green-100 text-green-700">Completed</span>
                  {b.completion_email_sent_at == null && (
                    <p className="mt-1 text-xs text-amber-600">
                      Photo email couldn't be sent (check email settings) — the
                      customer was not notified.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Transaction history — every booking with its money movement (ledger) */}
      <section className="card mt-6 p-5">
        <h2 className="mb-1 font-display text-lg font-bold">Transaction history</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Every booking with its payment split — service price, Stripe fee, credit
          applied and the net cash that moved. The same ledger feeds the analytics
          dashboard.
        </p>
        {history === null ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            Loading history…
          </p>
        ) : history.length === 0 ? (
          <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
            No transactions yet. Paid bookings will appear here automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Paid on</th>
                  <th className="py-2 pr-3 text-right">Amount breakdown</th>
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.booking_id} className="border-b border-line align-top last:border-0">
                    <td className="py-3 pr-3">
                      <TransactionStatusBadge t={t} />
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-bold">{t.service_name || "—"}</p>
                      <p className="text-xs text-ink-soft">{t.reference}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-bold">{t.customer_name}</p>
                      <p className="text-xs text-ink-soft">{t.customer_email}</p>
                    </td>
                    <td className="py-3 pr-3 text-xs text-ink-soft">
                      {t.slot_starts_at ? formatDateTime(t.slot_starts_at) : "—"}
                    </td>
                    <td className="py-3 pr-3 text-xs text-ink-soft">
                      {t.paid_at ? formatCreated(t.paid_at) : "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <AmountBreakdown t={t} />
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

/* ═══════════════════════════════════════════════════════════
 * Service completion (Phase B part 3) — UI helpers
 * ═══════════════════════════════════════════════════════════ */

/**
 * Downscale an image file to a JPEG data URL (max edge COMPLETION_PHOTO_MAX_EDGE,
 * quality 0.85). Keeps the wire payload (server fn body) and the email
 * attachment small even for phone photos.
 */
function fileToDataUrl(file: File, maxEdge: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the photo file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(new Error("Couldn't decode that image — please try a different photo."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't prepare the photo."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Photo picker for the completion panel — photo is REQUIRED before submitting. */
function CompletionPhotoPicker({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (photoUrl: string) => void;
  onCancel: () => void;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onFile(file: File | undefined) {
    setLocalErr(null);
    if (!file) return;
    if (!COMPLETION_PHOTO_ACCEPT.includes(file.type)) {
      setLocalErr("Please choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > COMPLETION_PHOTO_MAX_BYTES) {
      setLocalErr("That photo is over 8 MB — please choose a smaller one.");
      return;
    }
    try {
      const url = await fileToDataUrl(file, COMPLETION_PHOTO_MAX_EDGE);
      setPhotoUrl(url);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Couldn't prepare the photo.");
    }
  }

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept={COMPLETION_PHOTO_ACCEPT.join(",")}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-4">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt="Serviced vehicle preview"
            className="h-24 w-32 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-24 w-32 items-center justify-center rounded-lg border border-dashed border-green-400 bg-white/60 text-center text-xs text-green-800">
            Photo required
          </div>
        )}
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            className="btn-outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {photoUrl ? "Choose another photo" : "Choose photo"}
          </button>
          <p className="text-xs text-green-900">
            Photo of the serviced vehicle (JPEG / PNG / WebP, up to 8 MB). It's
            sent to the customer with the completion email.
          </p>
        </div>
      </div>
      {localErr && <p className="mt-2 text-sm font-semibold text-red-700">{localErr}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
          disabled={busy || !photoUrl}
          onClick={() => photoUrl && onConfirm(photoUrl)}
        >
          {busy ? "Completing…" : "Complete service & notify customer"}
        </button>
        <button type="button" className="btn-outline" disabled={busy} onClick={onCancel}>
          Not yet
        </button>
      </div>
    </div>
  );
}

/** 64px thumbnail of the serviced-vehicle photo, fetched on demand (the data URL
 *  is deliberately excluded from the dashboard payload). */
function CompletionThumb({ bookingId }: { bookingId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const token = getSessionToken();
      if (!token) return;
      const res = await getCompletionPhoto({ data: { token, bookingId } });
      if (active && res.ok && res.photoUrl) setUrl(res.photoUrl);
    })();
    return () => {
      active = false;
    };
  }, [bookingId]);
  if (!url) return <div className="h-12 w-16 shrink-0 rounded-md bg-surface" />;
  return (
    <img src={url} alt="Serviced vehicle" className="h-12 w-16 shrink-0 rounded-md object-cover" />
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "completed":
      return "Completed";
    case "confirmed":
    case "paid":
      return "Paid";
    case "pending":
      return "Pending";
    case "awaiting_payment":
      return "Awaiting payment";
    case "cancellation_pending":
      return "Customer choosing";
    case "rescheduled":
      return "Rescheduled";
    case "cancelled":
      return "Cancelled";
    case "credited":
      return "Credited";
    default:
      return s;
  }
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case "completed":
      return "bg-green-100 text-green-700";
    case "confirmed":
    case "paid":
      return "bg-green-50 text-green-700";
    case "cancelled":
    case "credited":
      return "bg-surface text-ink-soft";
    case "cancellation_pending":
      return "bg-amber-100 text-amber-700";
    case "awaiting_payment":
    case "pending":
      return "bg-amber-50 text-amber-700";
    case "rescheduled":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-surface text-ink-soft";
  }
}

/** Service lifecycle badge (+ the ledger's money state underneath). */
function TransactionStatusBadge({ t }: { t: OwnerTransactionRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`chip ${statusBadgeClass(t.booking_status)}`}>
        {statusLabel(t.booking_status)}
      </span>
      {t.transaction_status && t.transaction_status !== t.booking_status && (
        <span className="text-xs text-ink-soft">{statusLabel(t.transaction_status)}</span>
      )}
    </div>
  );
}

/** Money split for one history row: service / fee / credit applied / net cash. */
function AmountBreakdown({ t }: { t: OwnerTransactionRow }) {
  const money = (c: number | null) => (c == null ? "—" : formatAUD(c));
  return (
    <div className="text-right text-xs leading-relaxed">
      {t.total_cents == null ? (
        <span className="text-ink-soft">—</span>
      ) : (
        <>
          <p>
            Service{" "}
            <span className="font-semibold text-ink">{money(t.service_cents)}</span>
          </p>
          <p className="text-ink-soft">
            Stripe fee <span className="font-semibold">{money(t.fee_cents)}</span>
          </p>
          {t.credit_applied_cents != null && t.credit_applied_cents > 0 && (
            <p className="text-amber-700">
              Credit applied <span className="font-semibold">−{money(t.credit_applied_cents)}</span>
            </p>
          )}
          <p className="font-bold text-ink">
            Net cash {money(t.net_cash_cents ?? t.total_cents)}
          </p>
        </>
      )}
      {t.credit_issued_cents != null && t.credit_issued_cents > 0 && (
        <p className="text-amber-700">
          Credit issued {money(t.credit_issued_cents)}
        </p>
      )}
      {t.completed_at && (
        <p className="text-ink-soft">Completed {formatCreated(t.completed_at)}</p>
      )}
    </div>
  );
}
