import { describe, it, expect } from "vitest";
import { prorate } from "../../src/lib/proration.js";
import { ProrationUncomputableError } from "../../src/lib/errors.js";

// T031: prorate() boundary days (last day, same-day), zero/inverted period throws,
// minor-unit rounding exactness. (FR-016, research.md §5)

const DAY = 24 * 60 * 60 * 1000;

describe("prorate — daily proration (research.md §5)", () => {
  it("a full period remaining ≈ full price (MONTHLY 30 days)", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const end = new Date(now.getTime() + 30 * DAY);
    const r = prorate(2500, "MONTHLY", end, now);
    expect(r.periodDays).toBe(30);
    expect(r.remainingDays).toBe(30);
    expect(r.amountMinor).toBe(2500);
  });

  it("half a month remaining → ~half the price", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const end = new Date(now.getTime() + 15 * DAY);
    const r = prorate(2500, "MONTHLY", end, now);
    expect(r.remainingDays).toBe(15);
    // round(2500 * 15 / 30) = 1250
    expect(r.amountMinor).toBe(1250);
  });

  it("one day remaining (last day) → 1/30 of the price, rounded", () => {
    const now = new Date("2026-06-29T00:00:00Z");
    const end = new Date(now.getTime() + 1 * DAY);
    const r = prorate(2500, "MONTHLY", end, now);
    expect(r.remainingDays).toBe(1);
    // round(2500 * 1 / 30) = round(83.33) = 83
    expect(r.amountMinor).toBe(83);
  });

  it("same-day (a partial day left) counts as one remaining day (ceil)", () => {
    const now = new Date("2026-06-29T06:00:00Z");
    const end = new Date("2026-06-29T18:00:00Z"); // 12h left
    const r = prorate(2500, "MONTHLY", end, now);
    expect(r.remainingDays).toBe(1);
    expect(r.amountMinor).toBe(83);
  });

  it("YEARLY uses a 365-day period", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const end = new Date(now.getTime() + 365 * DAY);
    const r = prorate(36500, "YEARLY", end, now);
    expect(r.periodDays).toBe(365);
    expect(r.remainingDays).toBe(365);
    expect(r.amountMinor).toBe(36500);
  });

  it("clamps remaining days to the period length (stale long period)", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const end = new Date(now.getTime() + 100 * DAY); // longer than a month
    const r = prorate(2500, "MONTHLY", end, now);
    expect(r.remainingDays).toBe(30);
    expect(r.amountMinor).toBe(2500);
  });

  it("throws PRORATION_UNCOMPUTABLE on a zero-length period", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(() => prorate(2500, "MONTHLY", now, now)).toThrowError(ProrationUncomputableError);
  });

  it("throws PRORATION_UNCOMPUTABLE on an inverted (past) period", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const end = new Date(now.getTime() - 5 * DAY);
    expect(() => prorate(2500, "MONTHLY", end, now)).toThrowError(ProrationUncomputableError);
  });

  it("rounds to the nearest minor unit (no fractional halalas)", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const end = new Date(now.getTime() + 7 * DAY);
    const r = prorate(2500, "MONTHLY", end, now);
    // round(2500 * 7 / 30) = round(583.33) = 583
    expect(r.amountMinor).toBe(583);
    expect(Number.isInteger(r.amountMinor)).toBe(true);
  });
});
