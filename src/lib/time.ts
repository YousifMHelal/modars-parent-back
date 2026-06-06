/** Parses a short duration string like "15m", "30d", "900s" into seconds.
 *  Returns `fallback` when the input doesn't match the `<number><s|m|h|d>` form. */
export function parseTtlToSeconds(raw: string, fallback: number): number {
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return fallback;
  const n = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return fallback;
  }
}
