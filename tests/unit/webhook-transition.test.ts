import { describe, it, expect } from "vitest";
import { resolveTransition } from "../../src/modules/webhooks/transition.js";

// T025: the event-type → SubscriptionStatus transition resolver covers every row of
// data-model.md §2, including out-of-order resolution (each event applied against the
// row's current status).

describe("resolveTransition — data-model.md §2", () => {
  it("PENDING + payment_succeeded → ACTIVE (first activation)", () => {
    expect(resolveTransition("PENDING", "payment_succeeded")).toBe("ACTIVE");
  });

  it("PENDING + payment_failed → no transition (stays PENDING, retryable)", () => {
    expect(resolveTransition("PENDING", "payment_failed")).toBeNull();
  });

  it("ACTIVE + renewal_succeeded → ACTIVE (extend)", () => {
    expect(resolveTransition("ACTIVE", "renewal_succeeded")).toBe("ACTIVE");
  });

  it("ACTIVE + payment_failed → PAST_DUE", () => {
    expect(resolveTransition("ACTIVE", "payment_failed")).toBe("PAST_DUE");
  });

  it("ACTIVE + renewal_failed → PAST_DUE", () => {
    expect(resolveTransition("ACTIVE", "renewal_failed")).toBe("PAST_DUE");
  });

  it("ACTIVE + disputed → PAST_DUE", () => {
    expect(resolveTransition("ACTIVE", "disputed")).toBe("PAST_DUE");
  });

  it("PAST_DUE + payment_succeeded → ACTIVE (recovery)", () => {
    expect(resolveTransition("PAST_DUE", "payment_succeeded")).toBe("ACTIVE");
  });

  it("PAST_DUE + renewal_succeeded → ACTIVE (recovery via renewal)", () => {
    expect(resolveTransition("PAST_DUE", "renewal_succeeded")).toBe("ACTIVE");
  });

  it("ACTIVE + refunded → PAST_DUE (access removed)", () => {
    expect(resolveTransition("ACTIVE", "refunded")).toBe("PAST_DUE");
  });

  it("PAST_DUE + refunded → PAST_DUE (access removed)", () => {
    expect(resolveTransition("PAST_DUE", "refunded")).toBe("PAST_DUE");
  });

  it("out-of-order: a failure arriving on an already-CANCELED sub is a no-op", () => {
    expect(resolveTransition("CANCELED", "payment_failed")).toBeNull();
    expect(resolveTransition("CANCELED", "payment_succeeded")).toBeNull();
    expect(resolveTransition("CANCELED", "refunded")).toBeNull();
  });

  it("idempotent re-confirm: ACTIVE + payment_succeeded stays ACTIVE", () => {
    expect(resolveTransition("ACTIVE", "payment_succeeded")).toBe("ACTIVE");
  });
});
