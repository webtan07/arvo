import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  getShop,
  getSlotGrid,
  createBooking,
  getFeeSchedule,
  getCustomerCredits,
} from "~/db/server";
import type {
  CreateBookingResult,
  CustomerCreditsResult,
  FeeSchedule,
  GridSlot,
  ServiceRow,
  ShopRow,
} from "~/db/server";
import { getSessionUser } from "~/db/auth";
import type { SessionUser } from "~/db/auth";
import { getSessionToken } from "~/lib/session";
import { formatDuration, formatAUD, formatSlotDate, formatTime } from "~/lib/format";
import { calculateFees } from "~/lib/fees";
import PaymentForm from "~/components/PaymentForm";

export const Route = createFileRoute("/book")({
  validateSearch: (search: Record<string, unknown>) => ({
    shop: typeof search.shop === "string" ? search.shop : undefined,
    service: typeof search.service === "string" ? search.service : undefined,
  }),
  component: BookPage,
});

type Step = "slot" | "details" | "payment";

function BookPage() {
  const navigate = useNavigate();
  const { shop: shopSlug, service: serviceSlug } = Route.useSearch();

  const [shopData, setShopData] = useState<{ shop: ShopRow; services: ServiceRow[] } | null>(null);
  const [slots, setSlots] = useState<GridSlot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);

  const [step, setStep] = useState<Step>("slot");
  const [slotId, setSlotId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBookingResult | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  // Active credit balance for the email entered in the details step — offered
  // (opt-in checkbox, UNCHECKED by default) at the payment step only.
  const [credits, setCredits] = useState<CustomerCreditsResult | null>(null);
  const [applyCredit, setApplyCredit] = useState(false);

  // If a customer is logged in, resolve their session once so we can prefill
  // the details form and link the new booking to their account.
  useEffect(() => {
    if (typeof window === "undefined" || !getSessionToken()) return;
    let active = true;
    (async () => {
      const token = getSessionToken()!;
      const u = await getSessionUser({ data: token });
      if (active && u && u.role === "customer") {
        setSessionUser(u);
        setName(u.name || "");
        setEmail(u.email);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shopSlug) {
      navigate({ to: "/" });
      return;
    }
    let active = true;
    (async () => {
      try {
        const [shopResult, slotResult, feeResult] = await Promise.all([
          getShop({ data: shopSlug }),
          getSlotGrid({ data: { shopSlug } }),
          getFeeSchedule(),
        ]);
        if (!active) return;
        if (!shopResult) {
          setLoadError("Mobile service not found.");
          return;
        }
        setShopData(shopResult);
        setSlots(slotResult);
        setFeeSchedule(feeResult);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [shopSlug, navigate]);

  // Fetch the active credit balance for the entered email when the customer
  // reaches the payment step. Credit application is OPT-IN (checkbox, unchecked
  // by default) — it is never auto-applied.
  useEffect(() => {
    if (step !== "payment" || !email) return;
    let active = true;
    (async () => {
      try {
        const res = await getCustomerCredits({ data: { email } });
        if (!active) return;
        setCredits(res);
        if (res.ok && res.totals.activeCents <= 0) setApplyCredit(false);
      } catch (e) {
        if (active) {
          setCredits(null);
          console.error("Failed to load credit balance:", e);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [step, email]);

  const service = useMemo(
    () => shopData?.services.find((s) => s.slug === serviceSlug) ?? null,
    [shopData, serviceSlug],
  );

  // Exact fee split (reused for the breakdown and the credit offer).
  const feeBreakdown = useMemo(() => {
    if (!feeSchedule || !service) return null;
    return calculateFees(service.price_cents, {
      percent: feeSchedule.percent,
      fixedCents: feeSchedule.fixedCents,
    });
  }, [feeSchedule, service]);

  // Opt-in credit: UNCHECKED by default; when checked, the balance reduces the
  // amount charged (total = service + fee − credit).
  const activeCredits = useMemo(
    () =>
      credits?.ok
        ? credits.credits.filter((c) => c.effectiveStatus === "active")
        : [],
    [credits],
  );
  const activeCreditCents = useMemo(
    () => activeCredits.reduce((s, c) => s + c.amount_cents, 0),
    [activeCredits],
  );
  const creditExpiryLabel = useMemo(() => {
    if (activeCredits.length === 0) return null;
    const earliest = activeCredits.reduce((min, c) =>
      c.expires_at < min.expires_at ? c : min,
    );
    return new Date(earliest.expires_at).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [activeCredits]);
  const creditToApply = applyCredit
    ? Math.min(activeCreditCents, feeBreakdown?.totalCents ?? 0)
    : 0;
  const chargedCents = feeBreakdown ? feeBreakdown.totalCents - creditToApply : 0;

  const groupedSlots = useMemo(() => {
    const map = new Map<string, GridSlot[]>();
    for (const s of slots) {
      const key = formatSlotDate(s.starts_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries());
  }, [slots]);

  const selectedSlot = useMemo(
    () => slots.find((s) => String(s.id) === slotId) ?? null,
    [slots, slotId],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <p className="text-lg font-semibold text-red-600">{loadError}</p>
        <Link to="/" className="btn mt-4">Browse services</Link>
      </div>
    );
  }
  if (!shopData || !service) {
    return <div className="mx-auto max-w-2xl px-5 py-16 text-center">Loading booking…</div>;
  }

  const goToConfirm = (id: number) => navigate({ to: "/confirm/$id", params: { id: String(id) } });

  async function handleConfirm() {
    if (!slotId || !shopSlug || !serviceSlug) return;
    setCreating(true);
    setCreateErr(null);
    // Every booking pays now — there is no "pay on the day" option.
    const res = await createBooking({
      data: {
        shopSlug,
        serviceSlug,
        slotId,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        customerId: sessionUser?.id ?? null,
        applyCredit,
      },
    });
    setCreating(false);
    if (!res.ok || !res.booking) {
      setCreateErr(res.error || "Booking failed. Please try again.");
      return;
    }
    // Bookings always carry a payment intent (real Stripe or demo mode), so we
    // hand off to the card form. Fall back to the confirmation page if no
    // payment payload came back (defensive only).
    if (!res.payment) {
      goToConfirm(res.booking.id);
      return;
    }
    setCreated(res);
  }

  const canConfirmDetails = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-2 text-sm font-semibold">
        {(["slot", "details", "payment"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                step === s ? "bg-brand text-white" : "bg-surface text-ink-soft"
              }`}
            >
              {i + 1}
            </span>
            <span className={step === s ? "text-ink" : "text-ink-soft"}>
              {s === "slot" ? "Time" : s === "details" ? "Details" : "Payment"}
            </span>
            {i < 2 && <span className="text-ink-soft">→</span>}
          </span>
        ))}
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-soft">{shopData.shop.name}</p>
            <h1 className="font-display text-2xl font-extrabold">{service.name}</h1>
          </div>
          <div className="text-right">
            <p className="font-display text-xl font-extrabold text-brand">
              {formatAUD(service.price_cents)}
            </p>
            <p className="text-sm text-ink-soft">{formatDuration(service.duration_min)}</p>
          </div>
        </div>
      </div>

      {step === "slot" && (
        <section>
          <h2 className="mb-4 font-display text-xl font-bold">Choose a time</h2>
          <p className="mb-4 text-sm text-ink-soft">
            Bookings close 3 hours before the slot starts. Greyed-out times are
            already booked or unavailable.
          </p>
          {groupedSlots.length === 0 ? (
            <p className="rounded-xl bg-surface p-6 text-center text-ink-soft">
              No available slots in the next few days — please check back soon.
            </p>
          ) : (
            <div className="space-y-5">
              {groupedSlots.map(([day, daySlots]) => (
                <div key={day}>
                  <p className="mb-2 text-sm font-bold text-ink-soft">{day}</p>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((s) =>
                      s.available ? (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSlotId(String(s.id))}
                          className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                            slotId === String(s.id)
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-paper hover:border-brand hover:text-brand"
                          }`}
                        >
                          {formatTime(s.starts_at)}
                        </button>
                      ) : (
                        <button
                          key={s.id}
                          type="button"
                          disabled
                          aria-disabled="true"
                          title={s.is_open ? "Already booked" : "Unavailable"}
                          className="cursor-not-allowed rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-soft opacity-45"
                        >
                          {formatTime(s.starts_at)}
                          <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide">
                            {s.is_open ? "Booked" : "Unavailable"}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <button
              className="btn"
              disabled={!slotId}
              onClick={() => setStep("details")}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "details" && (
        <section>
          <h2 className="mb-4 font-display text-xl font-bold">Your details</h2>
          {sessionUser ? (
            <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">
              Signed in as <b>{sessionUser.name || sessionUser.email}</b>. Booking will be
              linked to your account.{" "}
              <Link to="/account" className="font-bold underline">
                My bookings
              </Link>
            </p>
          ) : (
            <p className="mb-4 rounded-xl bg-surface p-3 text-sm text-ink-soft">
              Have an account?{" "}
              <Link to="/login" className="font-bold text-brand hover:text-brand-dark">
                Log in
              </Link>{" "}
              to auto-fill your details and manage bookings. You can also continue as a guest.
            </p>
          )}
          <div className="card space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-semibold">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">
                Phone <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0400 000 000"
              />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between">
            <button className="btn-outline" onClick={() => setStep("slot")}>
              ← Back
            </button>
            <button className="btn" disabled={!canConfirmDetails} onClick={() => setStep("payment")}>
              Continue to payment
            </button>
          </div>
        </section>
      )}

      {step === "payment" && (
        <section>
          <h2 className="mb-4 font-display text-xl font-bold">Payment</h2>
          <div className="card space-y-4 p-5">
            <p className="rounded-xl bg-surface p-3 text-sm text-ink-soft">
              Payment is taken securely at booking — there's no "pay on the day"
              option.
            </p>

            {selectedSlot && (
              <p className="rounded-xl bg-surface p-3 text-sm text-ink-soft">
                {formatSlotDate(selectedSlot.starts_at)} at{" "}
                {formatTime(selectedSlot.starts_at)} · {shopData.shop.name} · {service.name}
                {" · "}
                <span className="font-semibold text-brand">{formatAUD(service.price_cents)}</span>
              </p>
            )}

            {/* Transparent breakdown before the customer commits: this is the
                exact split the server will charge (service + Stripe fee − credit). */}
            {feeSchedule && feeBreakdown && (
              <div className="rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Service</span>
                  <span className="font-semibold">{formatAUD(service.price_cents)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-ink-soft">Stripe fee ({feeSchedule.rateLabel})</span>
                  <span className="font-semibold">{formatAUD(feeBreakdown.feeCents)}</span>
                </div>
                {creditToApply > 0 && (
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-ink-soft">Credit applied</span>
                    <span className="font-semibold text-brand">−{formatAUD(creditToApply)}</span>
                  </div>
                )}
                <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
                  <span className="font-bold text-ink">Total due</span>
                  <span className="font-display font-extrabold text-brand">
                    {formatAUD(chargedCents)}
                  </span>
                </div>
              </div>
            )}

            {/* Opt-in credit offer — UNCHECKED by default, never auto-applied.
                Only offered when the entered email actually has an active balance. */}
            {activeCreditCents > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-brand"
                  checked={applyCredit}
                  onChange={(e) => setApplyCredit(e.target.checked)}
                />
                <span>
                  <span className="font-bold text-ink">
                    You have {formatAUD(activeCreditCents)} credit
                    {creditExpiryLabel ? ` · expires ${creditExpiryLabel}` : ""}
                  </span>
                  <span className="block text-ink-soft">
                    Tick to apply your credit — we'll only charge{" "}
                    {formatAUD(Math.max(chargedCents, 0))} (the difference after credit).
                  </span>
                </span>
              </label>
            )}

            {createErr && <p className="text-sm text-red-600">{createErr}</p>}

            {!created && (
              <button
                className="btn w-full"
                disabled={creating}
                onClick={handleConfirm}
              >
                {creating ? "Please wait…" : "Confirm booking"}
              </button>
            )}

            {/* Card collection after the booking is created (real Stripe or demo mode) */}
            {created?.ok && created.booking && created.payment && (
              <div className="mt-2 border-t border-line pt-4">
                {created.payment.paidInFull ? (
                  /* Credit fully covered the total — no card needed, the booking
                     is already confirmed/paid. */
                  <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                    <p className="font-bold">
                      Paid in full with your credit — nothing to pay.
                    </p>
                    <p className="mt-1">
                      Your booking is confirmed. We've emailed you the receipt.
                    </p>
                    <button
                      type="button"
                      className="btn mt-3"
                      onClick={() => goToConfirm(created.booking!.id)}
                    >
                      View confirmation
                    </button>
                  </div>
                ) : (
                  <PaymentForm
                    payment={created.payment}
                    bookingId={created.booking.id}
                    onPaid={() => goToConfirm(created.booking!.id)}
                  />
                )}
              </div>
            )}
          </div>
          <div className="mt-6">
            <button
              className="btn-outline"
              onClick={() => setStep("details")}
              disabled={creating}
            >
              ← Back
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
