"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { markBookingPaid } from "~/db/server";

export interface PaymentInfo {
  mode: "pay_online" | "pay_on_day";
  amountCents: number;
  amountDisplay: string;
  hasKeys: boolean;
  clientSecret?: string;
  publishableKey?: string;
}

interface Props {
  payment: PaymentInfo;
  bookingId: number;
  onPaid: () => void;
}

/**
 * Card collection for a pay-online booking.
 * - If real Stripe TEST keys are configured -> live Payment Element.
 * - Otherwise -> clearly-labelled demo mode (test card 4242 4242 4242 4242).
 */
export default function PaymentForm({ payment, bookingId, onPaid }: Props) {
  if (!payment.hasKeys || !payment.clientSecret || !payment.publishableKey) {
    return (
      <DemoPayment payment={payment} bookingId={bookingId} onPaid={onPaid} />
    );
  }

  const stripePromise = loadStripe(payment.publishableKey);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret }}>
      <LivePayment
        payment={payment}
        bookingId={bookingId}
        onPaid={onPaid}
      />
    </Elements>
  );
}

function LivePayment({ payment, bookingId, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);
    const returnUrl = `${window.location.origin}/confirm/${bookingId}`;
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (confirmError) {
      setError(confirmError.message || "Payment failed. Please try again.");
      setProcessing(false);
      return;
    }
    // Card is non-redirect, so a resolved call means success.
    await markBookingPaid({ data: bookingId });
    onPaid();
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <PaymentElement />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full" disabled={!stripe || processing}>
        {processing ? "Processing…" : `Pay ${payment.amountDisplay} now`}
      </button>
    </form>
  );
}

function DemoPayment({ payment, bookingId, onPaid }: Props) {
  const [card, setCard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    // Simulate a card charge (demo mode — no real Stripe keys configured).
    await new Promise((r) => setTimeout(r, 1100));
    await markBookingPaid({ data: bookingId });
    onPaid();
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-bold">Demo payment mode</p>
        <p className="mt-1">
          Stripe TEST keys are not configured yet, so the live card form is
          switched off. Use the test card below to simulate a card payment —
          no real charge is taken.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-semibold">Card number</label>
          <input
            className="input"
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-semibold">Expiry</label>
            <input className="input" placeholder="12 / 34" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">CVC</label>
            <input className="input" placeholder="123" />
          </div>
        </div>
        <p className="text-xs text-ink-soft">
          Demo only — any card details work. 4242 4242 4242 4242 / any future
          expiry / any CVC.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full" disabled={processing}>
        {processing ? "Processing…" : `Pay ${payment.amountDisplay} now`}
      </button>
    </form>
  );
}
