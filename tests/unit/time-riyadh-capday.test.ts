import { describe, it, expect } from "vitest";
import { riyadhCapDay, sameRiyadhDay, RIYADH_OFFSET_MINUTES } from "../../src/lib/time.js";

// Asia/Riyadh is UTC+3 (no DST), so its civil midnight is 21:00 UTC the prior day.
// These assert the day-boundary mapping is exact at the seam (research.md §4, FR-011).

describe("riyadhCapDay", () => {
  it("uses the fixed +180 minute (UTC+3) offset", () => {
    expect(RIYADH_OFFSET_MINUTES).toBe(180);
  });

  it("maps an instant just before Riyadh midnight to the prior civil day", () => {
    // 2026-06-06 20:59:59Z = 2026-06-06 23:59:59 in Riyadh → still the 6th.
    const justBefore = new Date("2026-06-06T20:59:59.000Z");
    expect(riyadhCapDay(justBefore)).toBe("2026-06-06");
  });

  it("maps an instant at Riyadh midnight to the next civil day", () => {
    // 2026-06-06 21:00:00Z = 2026-06-07 00:00:00 in Riyadh → the 7th.
    const atMidnight = new Date("2026-06-06T21:00:00.000Z");
    expect(riyadhCapDay(atMidnight)).toBe("2026-06-07");
  });

  it("maps a midday UTC instant to the same Riyadh date", () => {
    expect(riyadhCapDay(new Date("2026-06-06T12:00:00.000Z"))).toBe("2026-06-06");
  });

  it("rolls month/year boundaries correctly", () => {
    // 2025-12-31 21:30Z = 2026-01-01 00:30 Riyadh.
    expect(riyadhCapDay(new Date("2025-12-31T21:30:00.000Z"))).toBe("2026-01-01");
  });

  it("honours a custom offset", () => {
    // With a 0 offset, the UTC date is used directly.
    expect(riyadhCapDay(new Date("2026-06-06T23:00:00.000Z"), 0)).toBe("2026-06-06");
  });
});

describe("sameRiyadhDay", () => {
  it("is true for two instants within the same Riyadh civil day", () => {
    const a = new Date("2026-06-06T21:00:00.000Z"); // 7th 00:00 Riyadh
    const b = new Date("2026-06-07T20:59:00.000Z"); // 7th 23:59 Riyadh
    expect(sameRiyadhDay(a, b)).toBe(true);
  });

  it("is false across the Riyadh midnight seam", () => {
    const a = new Date("2026-06-06T20:59:00.000Z"); // 6th Riyadh
    const b = new Date("2026-06-06T21:01:00.000Z"); // 7th Riyadh
    expect(sameRiyadhDay(a, b)).toBe(false);
  });
});
