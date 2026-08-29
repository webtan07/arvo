import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { getShop, getSlotGrid, createBooking } from "~/db/server";
import type { CreateBookingResult, GridSlot, ServiceRow, ShopRow } from "~/db/server";
import { formatDuration, formatAUD, formatSlotDate, formatTime } from "~/lib/format";
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

  const [step, setStep] = useState<Step>("slot");
  const [slotId, setSlotId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBookingResult | null>(null);

  useEffect(() => {
    if (!shopSlug) {
      navigate({ to: "/" });
      return;
    }
    let active = true;
    (async () => {
      try {
        const [shopResult, slotResult] = await Promise.all([
          getShop({ data: shopSlug }),
          getSlotGrid({ data: { shopSlug } }),
        ]);
        if (!active) return;
        if (!shopResult) {
          setLoadError("Shop not found.");
          return;
        }
        setShopData(shopResult);
        setSlots(slotResult);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [shopSlug, navigate]);

  const service = useMemo(
    () => shopData?.services.find((s) => s.slug === serviceSlug) ?? null,
    [shopData, serviceSlug],
  );

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
        <Link to="/" className="btn mt-4">Browse shops</Link>
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
                <PaymentForm
                  payment={created.payment}
                  bookingId={created.booking.id}
                  onPaid={() => goToConfirm(created.booking!.id)}
                />
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
