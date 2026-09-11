/**
 * Stripe fee surcharge — the customer pays the service price PLUS Arvo's Stripe
 * processing cost, so the business receives the full service amount without
 * eating card fees.
 *
 * Fee model (single source of truth, shared by checkout UI + server):
 *
 *   feeCents  = round(serviceCents × percent / 100) + fixedCents
 *   totalCents = serviceCents + feeCents
 *
 * Defaults are Stripe's standard Australian rates with a NON-domestic-card
 * default (the safe/conservative choice for a marketplace that can receive
 * international cards):
 *
 *   STRIPE_FEE_PERCENT      2.9  (AU domestic card rate is 1.75 — set env
 *                                STRIPE_FEE_PERCENT=1.75 to switch)
 *   STRIPE_FEE_FIXED_CENTS  30   (30 AUD cents, same fixed fee for both rates)
 *
 * Both are env-overridable (server-side only — read via resolveFeeConfig in a
 * server module, e.g. src/db/server.ts). This module itself stays pure so it can
 * be imported from client code without touching process.env.
 *
 * Note: this is a simplified pass-through (fee computed on the service amount).
 * Stripe's real charge is computed on the total, so the business may still absorb
 * a tiny residual fraction of the fee — acceptable for v1 and documented here.
 */

export const FEE_PERCENT_DEFAULT = 2.9; // % — Stripe standard (non-AU domestic cards)
export const FEE_FIXED_CENTS_DEFAULT = 30; // AUD cents — Stripe per-transaction fee
export const FEE_CURRENCY = "aud"; // only AUD is supported today (matches services)

/**
 * Customer credit expiry (Phase B part 2). When a business owner cancels a paid
 * booking and the customer chooses "cancel for credit", the amount paid becomes
 * a credit valid for this many days from issue. Expired credits are forfeited
 * (not usable; shown as expired in the UI). Single config place for the policy.
 */
export const CREDIT_EXPIRY_DAYS = 90;

export interface FeeConfig {
  percent: number;
  fixedCents: number;
}

export interface FeeBreakdown {
  serviceCents: number;
  feeCents: number;
  totalCents: number;
}

/**
 * Read the fee config from env vars, falling back to the documented defaults.
 * Pass the env object explicitly (callers on the server pass process.env) so
 * this module never touches process.env directly and stays client-safe.
 */
export function resolveFeeConfig(
  env: { STRIPE_FEE_PERCENT?: string; STRIPE_FEE_FIXED_CENTS?: string } = {},
): FeeConfig {
  const parsedPercent = parseFloat(env.STRIPE_FEE_PERCENT ?? "");
  const percent = Number.isFinite(parsedPercent) && parsedPercent > 0 ? parsedPercent : FEE_PERCENT_DEFAULT;
  const parsedFixed = parseInt(env.STRIPE_FEE_FIXED_CENTS ?? "", 10);
  const fixedCents = Number.isFinite(parsedFixed) && parsedFixed >= 0 ? parsedFixed : FEE_FIXED_CENTS_DEFAULT;
  return { percent, fixedCents };
}

/** Compute the Stripe fee + grand total for a service price (cents, AUD). */
export function calculateFees(
  serviceCents: number,
  config: FeeConfig = { percent: FEE_PERCENT_DEFAULT, fixedCents: FEE_FIXED_CENTS_DEFAULT },
): FeeBreakdown {
  const feeCents = Math.round(((serviceCents * config.percent) / 100)) + config.fixedCents;
  return { serviceCents, feeCents, totalCents: serviceCents + feeCents };
}