import pino from "pino";
import type {
  Child,
  ReminderConfig,
  ReminderType,
  NotificationChannel,
} from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { buildAndDispatch, type NotificationIntent } from "../notifications/notifications.service.js";
import { sweepOverdueHomework } from "../homework/homework.service.js";
import { dispatchBillingNotifications } from "../billing/billing.service.js";

const logger = pino({ name: "reminders.service" });

// Per-child reminder evaluation → notification intents (FR-004/005/008a/009). Pure
// `evaluateChild` produces the intents; the central dispatcher (notifications.service)
// applies the cap/priority. The reminders worker calls `runRemindersSweep`, which fans
// every active child through `evaluateChild` and routes the intents through the
// dispatcher, then runs the time-driven homework OVERDUE transition (US2 wires the body).

// Channels we attempt per recipient. Push to everyone; email to the parent side. A
// WhatsApp-only config degrades gracefully in the dispatcher (FR-006); none is emitted
// here by default. (Per-config channel selection can override this later.)
const CHILD_CHANNELS: NotificationChannel[] = ["PUSH"];
const PARENT_CHANNELS: NotificationChannel[] = ["PUSH", "EMAIL"];

/**
 * Whether an enabled reminder's trigger condition holds for this child at `now`.
 * The detailed per-type schedule lives with the AI pipeline / scheduling data; for the
 * engine MVP an enabled reminder is considered due once per Riyadh day, with the
 * event-derived types (STRUGGLE_ALERT, ACHIEVEMENT, REWARD_REDEEMED) emitted by their
 * own producers rather than this time sweep.
 */
const SWEEP_DRIVEN_TYPES: ReadonlySet<ReminderType> = new Set<ReminderType>([
  "DAILY_STUDY",
  "HOMEWORK_DUE",
  "STREAK_PROTECTION",
  "MISSED_SESSION",
  "WEEKLY_SUMMARY",
  "EXAM_COUNTDOWN",
]);

export function triggerHolds(config: Pick<ReminderConfig, "type" | "enabled">): boolean {
  if (!config.enabled) return false;
  return SWEEP_DRIVEN_TYPES.has(config.type);
}

/**
 * Map one reminder config to its notification intent(s), honoring the recipient
 * (Child/Parent/Both → one intent each side, SC-003). Child-addressed reminder intents
 * count against the daily cap; parent-addressed ones do not (the cap protects the child).
 */
export function buildIntentsForReminder(
  config: Pick<ReminderConfig, "type" | "recipient" | "familyId" | "childId">,
  now: Date,
): NotificationIntent[] {
  const intents: NotificationIntent[] = [];
  const addChild = config.recipient === "CHILD" || config.recipient === "BOTH";
  const addParent = config.recipient === "PARENT" || config.recipient === "BOTH";
  const base = {
    familyId: config.familyId,
    type: config.type,
    source: "REMINDER" as const,
    title: reminderTitle(config.type),
    triggerTime: now,
  };

  if (addChild) {
    intents.push({
      ...base,
      childId: config.childId,
      recipient: "CHILD",
      channels: CHILD_CHANNELS,
      countsAgainstCap: true,
    });
  }
  if (addParent) {
    intents.push({
      ...base,
      childId: config.childId, // still scoped to the child the reminder concerns
      recipient: "PARENT",
      channels: PARENT_CHANNELS,
      countsAgainstCap: false,
    });
  }
  return intents;
}

function reminderTitle(type: ReminderType): string {
  switch (type) {
    case "DAILY_STUDY":
      return "Time to study";
    case "HOMEWORK_DUE":
      return "Homework due soon";
    case "STREAK_PROTECTION":
      return "Keep your streak alive";
    case "MISSED_SESSION":
      return "Missed study session";
    case "WEEKLY_SUMMARY":
      return "Weekly progress summary";
    case "STRUGGLE_ALERT":
      return "Struggle alert";
    case "EXAM_COUNTDOWN":
      return "Exam countdown";
    case "ACHIEVEMENT":
      return "Achievement unlocked";
    case "REWARD_REDEEMED":
      return "Reward redeemed";
    default:
      return "Reminder";
  }
}

/**
 * Produce all reminder intents for one child at `now`: every enabled, sweep-driven
 * reminder whose trigger holds, expanded by recipient. Skips paused / pending-purge
 * children for child-addressed reminders (FR-009) — handled by the caller's filter.
 */
export function evaluateChild(
  child: Pick<Child, "id" | "familyId" | "status" | "deletedAt">,
  configs: Pick<ReminderConfig, "type" | "enabled" | "recipient" | "familyId" | "childId">[],
  now: Date,
): NotificationIntent[] {
  const intents: NotificationIntent[] = [];
  const childInactive = child.status === "PAUSED" || child.deletedAt != null;

  for (const config of configs) {
    if (!triggerHolds(config)) continue;
    for (const intent of buildIntentsForReminder(config, now)) {
      // A paused/pending-purge child gets no CHILD-addressed reminders; parent-addressed
      // notices about the child still flow (FR-009).
      if (childInactive && intent.recipient === "CHILD") continue;
      intents.push(intent);
    }
  }
  return intents;
}

/**
 * The repeatable sweep entry point (reminders.worker). Evaluates every active child's
 * reminders, routes the intents through the central dispatcher (cap applied there), and
 * runs the time-driven homework OVERDUE transition (FR-016, body added in US2).
 */
export async function runRemindersSweep(
  now: Date = new Date(),
): Promise<{ children: number; delivered: number; suppressed: number; overdue: number }> {
  // Active, non-deleted children and their reminder configs.
  const children = await prisma.child.findMany({
    where: { deletedAt: null },
    select: { id: true, familyId: true, status: true, deletedAt: true },
  });

  let delivered = 0;
  let suppressed = 0;

  for (const child of children) {
    const configs = await prisma.reminderConfig.findMany({
      where: { childId: child.id, enabled: true },
      select: { type: true, enabled: true, recipient: true, familyId: true, childId: true },
    });
    const intents = evaluateChild(child, configs, now);
    if (intents.length === 0) continue;
    const result = await buildAndDispatch(intents, now);
    delivered += result.delivered;
    suppressed += result.suppressed;
  }

  // Time-driven OVERDUE transition for past-deadline unfinished homework (FR-016).
  const overdue = await sweepOverdueHomework(now);

  // Deferred Phase 5 billing notifications (renewal/dunning) on the same engine (FR-024).
  const billingDispatched = await dispatchBillingNotifications(now);
  delivered += billingDispatched;

  logger.info(
    { children: children.length, delivered, suppressed, overdue, billingDispatched },
    "reminders sweep evaluated",
  );
  return { children: children.length, delivered, suppressed, overdue };
}
