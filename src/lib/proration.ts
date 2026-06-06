import type { BillingCycle } from "../generated/prisma/client.js";
import { ProrationUncomputableError } from "./errors.js";

// Pure daily-proration helper (research.md §5, data-model.md §3). Computes the
// server-authoritative prorated amount for a one-off charge (overflow add-on, or a
// plan upgrade difference) over the remaining days of the current billing period.
//
// Kept free of I/O so its boundary cases (last day, same-day, expired/inverted
// period, minor-unit rounding) are unit-testable without a database.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nominal whole-period length per billing cycle, in days. */
const PERIOD_DAYS: Record<BillingCycle, number> = {
  MONTHLY: 30,
  YEARLY: 365,
};

export interface ProrationResult {
  amountMinor: number;
  remainingDays: number;
  periodDays: number;
}

/**
 * Prorate `fullPriceMinor` over the days remaining until `currentPeriodEnd`.
 *
 *   periodDays    = nominal days in the cycle (MONTHLY 30, YEARLY 365)
 *   remainingDays = ceil((currentPeriodEnd - now) / day), clamped to [0, periodDays]
 *   amountMinor   = round(fullPriceMinor * remainingDays / periodDays)
 *
 * Throws PRORATION_UNCOMPUTABLE (422) on a zero-length or inverted period — never a
 * zero or arbitrary charge (FR-016, edge case).
 */
export function prorate(
  fullPriceMinor: number,
  billingCycle: BillingCycle,
  currentPeriodEnd: Date,
  now: Date,
): ProrationResult {
  const periodDays = PERIOD_DAYS[billingCycle];

  const msRemaining = currentPeriodEnd.getTime() - now.getTime();
  if (msRemaining <= 0) {
    throw new ProrationUncomputableError(
      "Cannot prorate: the billing period has ended or is inverted",
    );
  }

  // Round remaining days up so a partial day still counts (the customer keeps access
  // for the rest of today). Clamp to the period so a stale/long period never charges
  // more than the full price.
  const remainingDays = Math.min(periodDays, Math.ceil(msRemaining / DAY_MS));

  const amountMinor = Math.round((fullPriceMinor * remainingDays) / periodDays);

  return { amountMinor, remainingDays, periodDays };
}
