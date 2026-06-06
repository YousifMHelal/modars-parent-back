import type { ReminderConfig, ReminderRecipient, ReminderType } from "@prisma/client";

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
  },
  {
    id: "homework-due",
    type: "HOMEWORK_DUE",
    label: "Homework Due",
    description: "Alert before homework deadlines",
    defaultRecipient: "Both",
    hasSettings: true,
  },
  {
    id: "streak-protection",
    type: "STREAK_PROTECTION",
    label: "Streak Protection",
    description: "Reminds child to keep their streak alive",
    defaultRecipient: "Child",
    hasSettings: true,
  },
  {
    id: "missed-session",
    type: "MISSED_SESSION",
    label: "Missed Session Alert",
    description: "Notifies you when child misses scheduled sessions",
    defaultRecipient: "Parent",
    hasSettings: true,
  },
  {
    id: "weekly-summary",
    type: "WEEKLY_SUMMARY",
    label: "Weekly Progress Summary",
    description: "Weekly overview of your child's progress",
    defaultRecipient: "Parent",
    hasSettings: true,
  },
  {
    id: "struggle-alert",
    type: "STRUGGLE_ALERT",
    label: "Struggle Alert",
    description: "Alert when child struggles on same topic repeatedly",
    defaultRecipient: "Parent",
    hasSettings: false,
  },
  {
    id: "exam-countdown",
    type: "EXAM_COUNTDOWN",
    label: "Exam Countdown",
    description: "Daily reminders leading up to exam dates",
    defaultRecipient: "Both",
    hasSettings: true,
  },
  {
    id: "achievement",
    type: "ACHIEVEMENT",
    label: "Achievement Unlocked",
    description: "Celebrate badges and level-ups",
    defaultRecipient: "Both",
    hasSettings: false,
  },
  {
    id: "reward-redeemed",
    type: "REWARD_REDEEMED",
    label: "Reward Redeemed",
    description: "Notifies when child reaches a reward goal",
    defaultRecipient: "Parent",
    hasSettings: false,
  },
];

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

/**
 * Rolls per-child ReminderConfig rows up to the family-level 9-entry list.
 * For each catalog type: enabled = OR across the family's children; recipient and
 * settings come from a representative row (first one found); types with no rows
 * still appear, using the catalog's default recipient and no settings.
 */
export function mergeFamilyReminderConfigs(
  configs: Pick<ReminderConfig, "type" | "enabled" | "recipient" | "settings">[],
): FamilyReminderEntry[] {
  const byType = new Map<ReminderType, typeof configs>();
  for (const cfg of configs) {
    const list = byType.get(cfg.type);
    if (list) list.push(cfg);
    else byType.set(cfg.type, [cfg]);
  }

  return REMINDER_CATALOG.map((entry) => {
    const rows = byType.get(entry.type) ?? [];
    const enabled = rows.some((r) => r.enabled);
    const representative = rows[0];

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
