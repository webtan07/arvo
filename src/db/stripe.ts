/**
 * Stripe TEST-MODE wiring for Arvo.
 *
 * TEST MODE ONLY — never a real charge. Two payment options at booking:
 *   - pay_online  -> a Stripe PaymentIntent is created server-side (amount in
 *                    pence); the client collects the card with Stripe.js
 *                    Payment Element and confirms it. Bookings stay
 *                    `awaiting_payment` until confirmation succeeds.
 *   - pay_on_day  -> no charge now; booking is confirmed immediately.
 *
 * If the owner has NOT yet pasted Stripe TEST keys, the app runs in `demo`
 * mode: `createBooking` returns `hasKeys:false`, and the booking page shows a
 * clearly-labelled simulated card form (test card 4242 4242 4242 4242) instead
 * of the live Payment Element. The moment STRIPE_SECRET_KEY and
 * STRIPE_PUBLISHABLE_KEY are set (TEST keys), the real flow activates with no
 * code changes.
 *
 * Keys to paste into .env/.env.example:
 *   STRIPE_SECRET_KEY=sk_test_...     (server)
 *   STRIPE_PUBLISHABLE_KEY=pk_test_... (client)
 * Standard Stripe test card: 4242 4242 4242 4242 / any future expiry / any CVC.
 * 3DS test card (if you want to exercise it): 4000 0025 0000 3155.
 */

export interface StripeConfig {
  hasKeys: boolean;
  secretKey: string;
  publishableKey: string;
}

export function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
  return { hasKeys: Boolean(secretKey && publishableKey), secretKey, publishableKey };
}

/**
 * Create a Stripe PaymentIntent (TEST MODE) via the REST API using fetch — no
 * server SDK dependency. Returns the intent id + client_secret needed to mount
 * the Payment Element. Throws if Stripe is not configured.
 */
export async function createPaymentIntent(opts: {
  amountCents: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  shopName: string;
  serviceName: string;
}): Promise<{ id: string; clientSecret: string }> {
  const cfg = getStripeConfig();
  if (!cfg.hasKeys) {
    throw new Error("Stripe TEST keys are not configured (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY).");
  }
  const body = new URLSearchParams({
    amount: String(opts.amountCents),
    currency: opts.currency,
    "automatic_payment_methods[enabled]": "true",
    "metadata[arvo_shop]": opts.shopName,
    "metadata[arvo_service]": opts.serviceName,
    "metadata[arvo_currency]": opts.currency,
  });
  if (opts.customerEmail) body.set("receipt_email", opts.customerEmail);

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as {
    id?: string;
    client_secret?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.id || !data.client_secret) {
    throw new Error(`Stripe PaymentIntent failed: ${data.error?.message || res.status}`);
  }
  return { id: data.id, clientSecret: data.client_secret };
}

/** Format cents (AUD) as a display string, e.g. 2500 -> "A$25.00". */
export function formatAUD(cents: number): string {
  return `A$${(cents / 100).toFixed(2)}`;
}
