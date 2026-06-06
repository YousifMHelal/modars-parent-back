import { describe, it, expect } from "vitest";
import {
  displayDate,
  durationLabel,
  homeworkDaysInfo,
  relativeDateTime,
  relativeTime,
} from "../../src/lib/time.js";

// Fixed reference: Fri Jun 6 2026, 15:00 local.
const NOW = new Date(2026, 5, 6, 15, 0, 0);

function minutesBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 60 * 1000);
}
function hoursBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 60 * 60 * 1000);
}
function daysBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("relativeTime buckets", () => {
  it("under a minute → Just now", () => {
    expect(relativeTime(new Date(NOW.getTime() - 30 * 1000), NOW)).toBe("Just now");
  });

  it("minutes ago (singular + plural)", () => {
    expect(relativeTime(minutesBefore(1), NOW)).toBe("1 minute ago");
    expect(relativeTime(minutesBefore(45), NOW)).toBe("45 minutes ago");
  });

  it("hours ago within the same calendar day", () => {
    expect(relativeTime(hoursBefore(2), NOW)).toBe("2 hours ago");
    expect(relativeTime(new Date(2026, 5, 6, 14, 0, 0), NOW)).toBe("1 hour ago");
  });

  it("previous calendar day → Yesterday", () => {
    expect(relativeTime(new Date(2026, 5, 5, 9, 0, 0), NOW)).toBe("Yesterday");
  });

  it("2–6 days → N days ago", () => {
    expect(relativeTime(daysBefore(3), NOW)).toBe("3 days ago");
    expect(relativeTime(daysBefore(6), NOW)).toBe("6 days ago");
  });

  it("7–13 days → Last week", () => {
    expect(relativeTime(daysBefore(7), NOW)).toBe("Last week");
    expect(relativeTime(daysBefore(13), NOW)).toBe("Last week");
  });

  it("14+ days → absolute short date", () => {
    expect(relativeTime(new Date(2026, 4, 20, 9, 0, 0), NOW)).toBe("May 20");
  });
});

describe("relativeDateTime", () => {
  it("today prefix", () => {
    expect(relativeDateTime(new Date(2026, 5, 6, 15, 0, 0), NOW)).toBe("Today, 3:00 PM");
  });
  it("yesterday prefix", () => {
    expect(relativeDateTime(new Date(2026, 5, 5, 16, 30, 0), NOW)).toBe("Yesterday, 4:30 PM");
  });
  it("older → MMM D, h:mm AM/PM", () => {
    expect(relativeDateTime(new Date(2026, 5, 1, 17, 0, 0), NOW)).toBe("Jun 1, 5:00 PM");
  });
  it("midnight renders as 12:00 AM", () => {
    expect(relativeDateTime(new Date(2026, 5, 6, 0, 0, 0), NOW)).toBe("Today, 12:00 AM");
  });
});

describe("homeworkDaysInfo per status", () => {
  it("completed on time / late", () => {
    expect(homeworkDaysInfo(daysBefore(5), "COMPLETED", NOW)).toBe("Completed on time");
    expect(homeworkDaysInfo(daysBefore(5), "COMPLETED_LATE", NOW)).toBe("Completed late");
  });
  it("overdue by N days", () => {
    expect(homeworkDaysInfo(daysBefore(6), "OVERDUE", NOW)).toBe("Overdue by 6 days");
    expect(homeworkDaysInfo(daysBefore(1), "OVERDUE", NOW)).toBe("Overdue by 1 day");
  });
  it("due in N days (future, not done)", () => {
    expect(homeworkDaysInfo(new Date(2026, 5, 7, 9, 0, 0), "IN_PROGRESS", NOW)).toBe(
      "Due in 1 day",
    );
    expect(homeworkDaysInfo(new Date(2026, 5, 9, 9, 0, 0), "PENDING", NOW)).toBe("Due in 3 days");
  });
  it("due today", () => {
    expect(homeworkDaysInfo(new Date(2026, 5, 6, 23, 0, 0), "PENDING", NOW)).toBe("Due today");
  });
});

describe("displayDate variants", () => {
  it("dob → '15 Mar 2011'", () => {
    expect(displayDate(new Date(2011, 2, 15), "dob")).toBe("15 Mar 2011");
  });
  it("short → 'Jun 6'", () => {
    expect(displayDate(new Date(2026, 5, 6), "short")).toBe("Jun 6");
  });
  it("long → 'January 15, 2026'", () => {
    expect(displayDate(new Date(2026, 0, 15), "long")).toBe("January 15, 2026");
  });
});

describe("durationLabel", () => {
  it("renders whole minutes", () => {
    expect(durationLabel(35)).toBe("35 min");
  });
});
