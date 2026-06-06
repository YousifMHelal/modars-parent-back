// Username suggestion + alternatives (research.md §3).
//
// Mirrors the front-end `generateUsername` (AddChildStep.tsx): lowercase the
// display name, turn whitespace runs into single underscores, strip any char
// outside [a-z0-9_], then append the current year. The authoritative uniqueness
// check stays the DB unique index at create time (FR-010) — these helpers are
// advisory UX only.

const USERNAME_RE = /^[a-zA-Z0-9_]{4,20}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/** Normalize a candidate to the stored, globally-unique lowercase form. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

/** Build a base username from a display name, matching the FE generator. */
export function suggestUsername(displayName: string, year = new Date().getFullYear()): string {
  const slug = displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = slug.length > 0 ? slug : "user";
  // Keep room for the `_${year}` suffix within the 20-char limit.
  const suffix = `_${year}`;
  const trimmed = base.slice(0, 20 - suffix.length);
  return `${trimmed}${suffix}`;
}

/**
 * Yield at least `count` available alternatives for a taken base.
 * `isTaken` reports whether a normalized candidate already exists; only
 * candidates that pass the format rule and are not taken are returned.
 */
export async function alternatives(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  count = 3,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();

  // First try short numeric suffixes, then a wider range, until we have enough.
  for (let n = 1; out.length < count && n <= 9999; n += 1) {
    const candidate = `${base}${n}`.slice(0, 20);
    const normalized = normalizeUsername(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!isValidUsername(candidate)) continue;
    if (await isTaken(normalized)) continue;
    out.push(candidate);
  }

  return out;
}
