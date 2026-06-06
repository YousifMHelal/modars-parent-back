// ── Relative-time & display formatters (Phase 3, data-model.md §F) ─────────────
//
// All helpers are deterministic given an explicit `now`, so they are unit-testable
// at the bucket boundaries and produce finished display strings (no client compute).

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Whole-day difference between two instants by calendar day (local), e.g. an
 *  instant late yesterday and one early today differ by 1 even if < 24h apart. */
function calendarDayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** "3:00 PM" style 12-hour clock time. */
function formatClockTime(d: Date): string {
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, "0")} ${meridiem}`;
}

/**
 * Relative phrasing for a past instant, matching the mock's observed buckets:
 *   <1m → "Just now"; <60m → "N minutes ago"; same calendar day → "N hours ago";
 *   previous calendar day → "Yesterday"; 2–6 days → "N days ago"; 7–13 → "Last week";
 *   otherwise an absolute "MMM D" style date.
 */
export function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < MS_PER_MINUTE) return "Just now";

  if (diffMs < MS_PER_HOUR) {
    const minutes = Math.floor(diffMs / MS_PER_MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const dayDiff = calendarDayDiff(date, now);

  if (dayDiff === 0) {
    const hours = Math.floor(diffMs / MS_PER_HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  if (dayDiff === 1) return "Yesterday";
  if (dayDiff >= 2 && dayDiff <= 6) return `${dayDiff} days ago`;
  if (dayDiff >= 7 && dayDiff <= 13) return "Last week";

  return displayDate(date, "short");
}

/**
 * Relative date+time for a session instant:
 *   today → "Today, 3:00 PM"; yesterday → "Yesterday, 4:30 PM";
 *   otherwise → "Jun 1, 5:00 PM".
 */
export function relativeDateTime(date: Date, now: Date): string {
  const dayDiff = calendarDayDiff(date, now);
  const time = formatClockTime(date);

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;

  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${time}`;
}

/**
 * Human-readable homework status/deadline line:
 *   COMPLETED → "Completed on time"; COMPLETED_LATE → "Completed late";
 *   OVERDUE → "Overdue by N days"; otherwise "Due in N day(s)" (today → "Due today").
 */
export function homeworkDaysInfo(deadline: Date, status: string, now: Date): string {
  if (status === "COMPLETED") return "Completed on time";
  if (status === "COMPLETED_LATE") return "Completed late";

  const dayDiff = calendarDayDiff(now, deadline);

  if (status === "OVERDUE" || dayDiff < 0) {
    const overdue = Math.abs(dayDiff);
    return `Overdue by ${overdue} day${overdue === 1 ? "" : "s"}`;
  }

  if (dayDiff === 0) return "Due today";
  return `Due in ${dayDiff} day${dayDiff === 1 ? "" : "s"}`;
}

export type DisplayDateVariant = "dob" | "short" | "long";

/**
 * Context-specific absolute date strings:
 *   "dob"   → "15 Mar 2011"      (child date of birth)
 *   "short" → "Jun 6"            (homework deadline / fallback relative date)
 *   "long"  → "January 15, 2026" (badge earned / subscription renewal)
 */
export function displayDate(date: Date, variant: DisplayDateVariant): string {
  const day = date.getDate();
  const monthShort = MONTHS_SHORT[date.getMonth()];
  const monthLong = MONTHS_LONG[date.getMonth()];
  const year = date.getFullYear();

  switch (variant) {
    case "dob":
      return `${day} ${monthShort} ${year}`;
    case "short":
      return `${monthShort} ${day}`;
    case "long":
      return `${monthLong} ${day}, ${year}`;
    default:
      return `${monthShort} ${day}, ${year}`;
  }
}

/** Renders a session/homework duration in whole minutes as "35 min". */
export function durationLabel(minutes: number): string {
  return `${minutes} min`;
}

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
