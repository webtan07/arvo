"use client";
import { useEffect, useState } from "react";
import {
  cancelBookingForCredit,
  getCancellationContext,
  getRescheduleSlots,
  rescheduleBooking,
} from "~/db/server";
import type { CancellationChoiceContext } from "~/db/server";
import { formatAUD, formatDateTime } from "~/lib/format";

/**
 * The "what happens next" UI after a mobile business cancels a booking. The
 * customer gets EXACTLY two options (owner's spec):
 *   a. RESCHEDULE — pick a new slot for the same service (same booking/payment;
 *      only slots for that business are offered).
 *   b. CANCEL FOR CREDIT — booking cancelled, amount paid becomes a 90-day
 *      credit (NO card refund).
 *
 * Used by both the email-link landing page (/reschedule/:id?token=…) and the
 * account page (session token). The server validates the actor either way.
 */
interface Props {
  bookingId: number;
  /** Decision token from the email link, or the customer's session token. */
  token?: string;
  /** Start with the credit-confirmation step expanded (email "cancel for credit" link). */
  initialAction?: "credit";
  /** Fired after the customer resolves (rescheduled or cancelled-for-credit). */
  onResolved?: () => void;
}

type Step =
  | "loading"
  | "choose"
  | "slots"
  | "confirm-credit"
  | "done-reschedule"
  | "done-credit"
  | "unavailable";

export default function CancellationAction({
  bookingId,
  token,
  initialAction,
  onResolved,
}: Props) {
  const [ctx, setCtx] = useState<CancellationChoiceContext | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<
    { id: number; starts_at: string; ends_at: string; is_open: boolean }[]
  >([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    kind: "rescheduled" | "credit";
    when?: string;
    amountCents?: number;
    expiresAt?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getCancellationContext({ data: { bookingId, token } });
        if (!active) return;
        setCtx(res);
        if (!res.ok) {
          setError(res.error || "This booking can't be actioned.");
          setStep("unavailable");
        } else if (initialAction === "credit") {
          setStep("confirm-credit");
        } else {
          setStep("choose");
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, token]);

  if (step === "loading") {
    return (
      <div className="rounded-xl bg-surface p-6 text-center text-sm text-ink-soft">
        Loading your options…
      </div>
    );
  }

  // Booking not found / already resolved / caller not the customer.
  if (error && !ctx?.ok) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <p className="text-sm font-semibold text-ink">{error}</p>
        <p className="mt-2 text-xs text-ink-soft">
          If you were emailed about this booking, use the link from the email. If
          you're signed in as the customer, refresh this page.
        </p>
      </div>
    );
  }

  const b = ctx?.booking;
  if (!b) return null;

  const creditDisplay = formatAUD(b.totalCents);
  const creditExpiry = b.creditExpiresAt
    ? new Date(b.creditExpiresAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  async function openSlots() {
    setError(null);
    setStep("slots");
    setBusy(true);
    try {
      const res = await getRescheduleSlots({ data: { bookingId, token } });
      if (!res.ok || !res.slots) {
        setError(res.error || "Couldn't load available times.");
        setStep("choose");
        return;
      }
      setSlots(res.slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReschedule() {
    if (selectedSlotId == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rescheduleBooking({ data: { bookingId, slotId: selectedSlotId, token } });
      if (!res.ok || !res.booking) {
        setError(res.error || "Reschedule failed. Please try again.");
        return;
      }
      setResult({ kind: "rescheduled", when: res.booking.slotStartsAt ?? undefined });
      setStep("done-reschedule");
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCredit() {
    setBusy(true);
    setError(null);
    try {
      const res = await cancelBookingForCredit({ data: { bookingId, token } });
      if (!res.ok || !res.credit) {
        setError(res.error || "Couldn't cancel for credit. Please try again.");
        return;
      }
      setResult({
        kind: "credit",
        amountCents: res.credit.amount_cents,
        expiresAt: res.credit.expires_at,
      });
      setStep("done-credit");
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "done-reschedule") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
        <p className="font-bold">Rescheduled ✅</p>
        <p className="mt-1">
          Your booking for <b>{b.serviceName}</b> at <b>{b.shopName}</b> is now:
        </p>
        {result?.when && (
          <p className="mt-2 font-bold">{formatDateTime(result.when)}</p>
        )}
        <p className="mt-2">
          Your payment carried over and the business has been notified of the new
          time. A confirmation email is on its way.
        </p>
      </div>
    );
  }

  if (step === "done-credit") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
        <p className="font-bold">Cancelled — credit issued 🎉</p>
        <p className="mt-1">
          Your booking is cancelled and{" "}
          <b>{formatAUD(result?.amountCents ?? b.totalCents)}</b> is now credit on
          your account
          {result?.expiresAt
            ? `, valid until ${new Date(result.expiresAt).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`
            : ""}
          . No card refund was issued — use the credit at your next checkout
          (tick the credit option to apply it).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{b.reference}</p>
        <p className="mt-1 font-display text-lg font-extrabold">{b.shopName}</p>
        <p className="text-sm text-ink-soft">
          {b.serviceName || "Service"}
          {b.slotStartsAt ? ` · was ${formatDateTime(b.slotStartsAt)}` : ""}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          The mobile business cancelled this appointment. Your payment is safe —
          you choose what happens next:
        </p>
      </div>

      {step === "choose" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="card p-5 text-left transition hover:border-brand"
            onClick={openSlots}
            disabled={busy}
          >
            <p className="font-display text-lg font-extrabold text-brand">Reschedule</p>
            <p className="mt-1 text-sm text-ink-soft">
              Pick a new time for the same service. Your payment carries over and
              the business is notified.
            </p>
            <span className="btn mt-4 w-full justify-center">{busy ? "Loading…" : "Choose a new time"}</span>
          </button>
          <button
            type="button"
            className="card border-amber-300 p-5 text-left transition hover:border-brand"
            onClick={() => setStep("confirm-credit")}
            disabled={busy}
          >
            <p className="font-display text-lg font-extrabold text-brand">
              Cancel for credit — {creditDisplay}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              No card refund. We hold {creditDisplay} as credit for your next
              booking, valid for 90 days.
            </p>
            <span className="btn-outline mt-4 w-full justify-center">Choose credit</span>
          </button>
        </div>
      )}

      {step === "slots" && (
        <div className="card p-5">
          <p className="mb-1 font-display text-lg font-extrabold">Pick a new time</p>
          <p className="mb-4 text-sm text-ink-soft">
            Times for <b>{b.serviceName}</b> at <b>{b.shopName}</b> — bookings
            close 3 hours before the slot starts.
          </p>
          {slots.length === 0 ? (
            <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-soft">
              No available times right now — please check back soon, or choose
              cancel-for-credit instead.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSlotId(s.id)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    selectedSlotId === s.id
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-paper hover:border-brand hover:text-brand"
                  }`}
                >
                  {formatDateTime(s.starts_at)}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" className="btn-outline" onClick={() => setStep("choose")} disabled={busy}>
              ← Back
            </button>
            <button type="button" className="btn" disabled={selectedSlotId == null || busy} onClick={confirmReschedule}>
              {busy ? "Rescheduling…" : "Confirm new time"}
            </button>
          </div>
        </div>
      )}

      {step === "confirm-credit" && (
        <div className="card border-amber-300 p-5">
          <p className="font-display text-lg font-extrabold">Cancel for credit</p>
          <p className="mt-1 text-sm text-ink-soft">
            Confirming will cancel <b>{b.serviceName}</b> at <b>{b.shopName}</b>{" "}
            and convert the <b>{creditDisplay}</b> you paid into a credit balance —
            <b> no card refund</b>.
          </p>
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            Credit: <b>{creditDisplay}</b> · valid until <b>{creditExpiry}</b> · usable at
            checkout on any booking.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" className="btn-outline" onClick={() => setStep("choose")} disabled={busy}>
              ← Back
            </button>
            <button type="button" className="btn" disabled={busy} onClick={confirmCredit}>
              {busy ? "Cancelling…" : "Yes, cancel for credit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}