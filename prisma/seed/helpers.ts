/**
 * Seed time-anchoring helpers (D12).
 * All relative times are expressed as offsets from a single NOW reference
 * captured at seed start so displays remain correct regardless of when the
 * seed runs.
 */

let _now: Date | null = null;

export function seedNow(): Date {
  if (!_now) _now = new Date();
  return _now;
}

/** Returns a Date `hours` hours before/after seedNow(). */
export function hoursAgo(hours: number): Date {
  return new Date(seedNow().getTime() - hours * 60 * 60 * 1000);
}

/** Returns a Date `days` days before seedNow(). */
export function daysAgo(days: number): Date {
  return new Date(seedNow().getTime() - days * 24 * 60 * 60 * 1000);
}

/** Returns a Date `days` days after seedNow(). */
export function daysFromNow(days: number): Date {
  return new Date(seedNow().getTime() + days * 24 * 60 * 60 * 1000);
}

/** Converts whole-unit amount to minor units (e.g. SAR 1,499 → 149900 halalas). */
export function toMinor(wholeAmount: number): number {
  return Math.round(wholeAmount * 100);
}
