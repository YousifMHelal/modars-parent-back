import type { SubscriptionStatus } from "../../generated/prisma/client.js";
import type { ProviderEventType } from "../../lib/payments/provider.js";

// Pure subscription state-machine resolver (data-model.md §2, research.md §4). Maps a
// (current status, verified event type) pair to the next status, or null when no
// transition is defined (a no-op). Extracted as a pure function so every row of the
// transition table — including out-of-order resolution — is unit-testable (T025)
// without Prisma. The actual side effects (invoices, period extension, slot grants)
// live in webhooks.service; this only decides the status.

export function resolveTransition(
  current: SubscriptionStatus,
  event: ProviderEventType,
): SubscriptionStatus | null {
  switch (event) {
    case "payment_succeeded":
      // PENDING → ACTIVE (first activation); PAST_DUE → ACTIVE (recovery).
      if (current === "PENDING") return "ACTIVE";
      if (current === "PAST_DUE") return "ACTIVE";
      // Already ACTIVE → stays ACTIVE (idempotent re-confirm).
      if (current === "ACTIVE") return "ACTIVE";
      return null;

    case "renewal_succeeded":
      // Renewal keeps/restores ACTIVE from ACTIVE or PAST_DUE.
      if (current === "ACTIVE" || current === "PAST_DUE") return "ACTIVE";
      return null;

    case "payment_failed":
    case "renewal_failed":
    case "disputed":
      // A failure/dispute on a live subscription drops it to PAST_DUE.
      if (current === "ACTIVE") return "PAST_DUE";
      // On PENDING, a failure leaves it PENDING (retryable) — no transition here.
      return null;

    case "refunded":
      // A refund removes access from a live or past-due subscription.
      if (current === "ACTIVE" || current === "PAST_DUE") return "PAST_DUE";
      return null;

    default:
      return null;
  }
}
