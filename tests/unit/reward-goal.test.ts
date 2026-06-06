import { describe, it, expect } from "vitest";
import { computeGoalMet } from "../../src/modules/rewards/rewards.service.js";

// Pure goal-derivation / claimable computation (research.md §1/§3). No Prisma.

describe("computeGoalMet", () => {
  it("is false when there is no goal (null target / progress)", () => {
    expect(computeGoalMet("ACTIVE", null, null)).toBe(false);
    expect(computeGoalMet("ACTIVE", null, 500)).toBe(false);
    expect(computeGoalMet("ACTIVE", 100, null)).toBe(false);
  });

  it("is true at the boundary progress == target while ACTIVE", () => {
    expect(computeGoalMet("ACTIVE", 100, 100)).toBe(true);
  });

  it("is true above the target while ACTIVE", () => {
    expect(computeGoalMet("ACTIVE", 100, 250)).toBe(true);
  });

  it("is false below the target", () => {
    expect(computeGoalMet("ACTIVE", 100, 99)).toBe(false);
  });

  it("is false once the reward is no longer ACTIVE (does not change status)", () => {
    expect(computeGoalMet("FULFILLED", 100, 250)).toBe(false);
    expect(computeGoalMet("EXPIRED", 100, 250)).toBe(false);
  });
});
