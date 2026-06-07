import type { ReminderConfig, ReminderRecipient, ReminderType } from "../generated/prisma/client.js";

// ── Reminder catalog (Phase 3, data-model.md §D / research.md §5) ──────────────
//
// ReminderConfig rows are stored per-child (@@unique([childId, type])), but the
// Reminders screen consumes a single family-level list of all 9 types. This module
// supplies the static per-type catalog (slug, label, description, default recipient,
// hasSettings) — matching the front-end mock copy — and rolls per-child rows up to
// the family-level list (enabled = OR across children).

export type ReminderRecipientLabel = "Child" | "Parent" | "Both";

export interface ReminderCatalogEntry {
  /** Stable per-type slug used as the entry id and the FE icon-map key. */
  id: string;
  /** ReminderType enum value this entry rolls up. */
  type: ReminderType;
  /** Display label, e.g. "Daily Study Reminder". */
  label: string;
  /** Static per-type copy (matches the mock). */
  description: string;
  /** Default recipient when no per-child row exists yet. */
  defaultRecipient: ReminderRecipientLabel;
  /** Whether this type renders a settings panel. */
  hasSettings: boolean;
  /**
   * Fixed per-type notification priority rank (research.md §3, FR-008a). Lower =
   * higher priority; the central dispatcher delivers the lowest-rank intents first
   * when more than the daily cap are eligible. 1 = MISSED_SESSION … 9 = REWARD_REDEEMED.
   */
  priorityRank: number;
}

// The fixed priority tier (research.md §3). Encoded once here; the dispatcher and the
// stored Notification.priorityRank both read from it so a new reminder type can never
// silently jump the cap (it must be given a rank).
export const REMINDER_PRIORITY_RANK: Record<ReminderType, number> = {
  MISSED_SESSION: 1,
  STRUGGLE_ALERT: 2,
  HOMEWORK_DUE: 3,
  EXAM_COUNTDOWN: 4,
  STREAK_PROTECTION: 5,
  DAILY_STUDY: 6,
  WEEKLY_SUMMARY: 7,
  ACHIEVEMENT: 8,
  REWARD_REDEEMED: 9,
};

/** The fixed priority rank for a reminder type (lower = higher priority). */
export function reminderPriorityRank(type: ReminderType): number {
  return REMINDER_PRIORITY_RANK[type];
}

/** The 9 reminder types in the mock's fixed display order. */
export const REMINDER_CATALOG: readonly ReminderCatalogEntry[] = [
  {
    id: "daily-study",
    type: "DAILY_STUDY",
    label: "Daily Study Reminder",
    description: "Reminds your child to start their learning session",
    defaultRecipient: "Child",
    hasSettings: true,
    priorityRank: 6,
  },
  {
    id: "homework-due",
    type: "HOMEWORK_DUE",
    label: "Homework Due",
    description: "Alert before homework deadlines",
    defaultRecipient: "Both",
    hasSettings: true,
    priorityRank: 3,
  },
  {
    id: "streak-protection",
    type: "STREAK_PROTECTION",
    label: "Streak Protection",
    description: "Reminds child to keep their streak alive",
    defaultRecipient: "Child",
    hasSettings: true,
    priorityRank: 5,
  },
  {
    id: "missed-session",
    type: "MISSED_SESSION",
    label: "Missed Session Alert",
    description: "Notifies you when child misses scheduled sessions",
    defaultRecipient: "Parent",
    hasSettings: true,
    priorityRank: 1,
  },
  {
    id: "weekly-summary",
    type: "WEEKLY_SUMMARY",
    label: "Weekly Progress Summary",
    description: "Weekly overview of your child's progress",
    defaultRecipient: "Parent",
    hasSettings: true,
    priorityRank: 7,
  },
  {
    id: "struggle-alert",
    type: "STRUGGLE_ALERT",
    label: "Struggle Alert",
    description: "Alert when child struggles on same topic repeatedly",
    defaultRecipient: "Parent",
    hasSettings: false,
    priorityRank: 2,
  },
  {
    id: "exam-countdown",
    type: "EXAM_COUNTDOWN",
    label: "Exam Countdown",
    description: "Daily reminders leading up to exam dates",
    defaultRecipient: "Both",
    hasSettings: true,
    priorityRank: 4,
  },
  {
    id: "achievement",
    type: "ACHIEVEMENT",
    label: "Achievement Unlocked",
    description: "Celebrate badges and level-ups",
    defaultRecipient: "Both",
    hasSettings: false,
    priorityRank: 8,
  },
  {
    id: "reward-redeemed",
    type: "REWARD_REDEEMED",
    label: "Reward Redeemed",
    description: "Notifies when child reaches a reward goal",
    defaultRecipient: "Parent",
    hasSettings: false,
    priorityRank: 9,
  },
];

/** Resolve a catalog slug (e.g. "daily-study") to its catalog entry, or null if unknown. */
export function reminderEntryForSlug(slug: string): ReminderCatalogEntry | null {
  return REMINDER_CATALOG.find((e) => e.id === slug) ?? null;
}

/** The ReminderRecipient enum value for a catalog default-recipient label. */
export function recipientEnumForLabel(label: ReminderRecipientLabel): ReminderRecipient {
  switch (label) {
    case "Child":
      return "CHILD";
    case "Parent":
      return "PARENT";
    case "Both":
      return "BOTH";
  }
}

/** A single family-level reminder entry as consumed by the Reminders screen. */
export interface FamilyReminderEntry {
  id: string;
  type: string;
  recipient: ReminderRecipientLabel;
  description: string;
  enabled: boolean;
  hasSettings: boolean;
  settings?: Record<string, unknown>;
}

function recipientLabel(recipient: ReminderRecipient): ReminderRecipientLabel {
  switch (recipient) {
    case "CHILD":
      return "Child";
    case "PARENT":
      return "Parent";
    case "BOTH":
      return "Both";
    default:
      return "Parent";
  }
}

/** A ReminderConfig row as consumed by the family-level rollup. `childId` is optional
 * but, when supplied, makes the representative selection deterministic. */
export type MergeableReminderRow = Pick<
  ReminderConfig,
  "type" | "enabled" | "recipient" | "settings"
> &
  Partial<Pick<ReminderConfig, "childId">>;

/**
 * Rolls per-child ReminderConfig rows up to the family-level 9-entry list.
 * For each catalog type: enabled = OR across the family's children; recipient and
 * settings come from a representative row; types with no rows still appear, using
 * the catalog's default recipient and no settings.
 *
 * The representative is chosen deterministically — the lowest `childId` for the type
 * — so the displayed recipient/settings never change between reads just because the
 * DB returned rows in a different order (the cause of the time/days appearing to
 * change on reload/login). When `childId` is unavailable the input order is kept.
 */
export function mergeFamilyReminderConfigs(
  configs: MergeableReminderRow[],
): FamilyReminderEntry[] {
  const byType = new Map<ReminderType, MergeableReminderRow[]>();
  for (const cfg of configs) {
    const list = byType.get(cfg.type);
    if (list) list.push(cfg);
    else byType.set(cfg.type, [cfg]);
  }

  return REMINDER_CATALOG.map((entry) => {
    const rows = byType.get(entry.type) ?? [];
    const enabled = rows.some((r) => r.enabled);
    // Deterministic representative: lowest childId when present.
    const representative = rows.reduce<MergeableReminderRow | undefined>((best, row) => {
      if (!best) return row;
      if (row.childId != null && best.childId != null) {
        return row.childId < best.childId ? row : best;
      }
      return best;
    }, undefined);

    const recipient = representative
      ? recipientLabel(representative.recipient)
      : entry.defaultRecipient;

    const result: FamilyReminderEntry = {
      id: entry.id,
      type: entry.label,
      recipient,
      description: entry.description,
      enabled,
      hasSettings: entry.hasSettings,
    };

    const settings = representative?.settings;
    if (settings != null && typeof settings === "object") {
      result.settings = settings as Record<string, unknown>;
    }

    return result;
  });
}
