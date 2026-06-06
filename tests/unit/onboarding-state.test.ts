import { describe, it, expect } from "vitest";
import { resolveNextStep } from "../../src/modules/onboarding/onboarding.service.js";

// Resume resolver (data-model.md §2): parent only → step 2; pending sub w/ plan →
// step 3; ≥1 child → step 4.
describe("resolveNextStep", () => {
  it("maps parent-only (no plan, no child) to step 2", () => {
    expect(resolveNextStep({ planChosen: false, childrenCount: 0 })).toBe(2);
  });

  it("maps a chosen plan with no child to step 3", () => {
    expect(resolveNextStep({ planChosen: true, childrenCount: 0 })).toBe(3);
  });

  it("maps ≥1 child to step 4 (payment)", () => {
    expect(resolveNextStep({ planChosen: true, childrenCount: 1 })).toBe(4);
    expect(resolveNextStep({ planChosen: true, childrenCount: 3 })).toBe(4);
  });

  it("treats a child without a recorded plan as step 4 (a child implies progress)", () => {
    expect(resolveNextStep({ planChosen: false, childrenCount: 1 })).toBe(4);
  });
});
