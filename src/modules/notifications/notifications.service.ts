import pino from "pino";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  Notification,
  NotificationChannel,
  NotificationRecipient,
  ReminderType,
  PushPlatform,
} from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import config from "../../config/index.js";
import { NotFoundError } from "../../lib/errors.js";
import { riyadhCapDay } from "../../lib/time.js";
import { reminderPriorityRank } from "../../lib/reminders.js";
import { notificationsQueue } from "../../jobs/queues.js";

const logger = pino({ name: "notifications.service" });

// ── The single central dispatcher (Principle V / FR-007) ──────────────────────
//
// `buildAndDispatch` is the ONLY code that writes a delivered Notification. Every
// reminder, struggle, and billing path produces intents and routes them here; none
// writes a Notification directly. Per (childId, Riyadh capDay) it enforces the daily
// cap: child-addressed reminder intents that count against the cap are sorted by fixed
// priorityRank (then earliest trigger time), the top remaining-budget delivered as
// PENDING (a job enqueued per channel), and the rest written SUPPRESSED. Because the
// cap is derived from persisted rows behind a unique (childId, capDay, type) guard, a
// retried/idempotent sweep never double-counts (FR-010), and adding a new reminder
// type can never raise the cap (SC-002).

/**
 * A request to notify, before the cap decision. Recipient/channel addressing and the
 * source type are resolved by the producer (reminders/billing/struggle); the dispatcher
 * decides delivery vs suppression.
 */
export interface NotificationIntent {
  familyId: string;
  /** Set for child-addressed notifications; null for parent-only (e.g. billing). */
  childId: string | null;
  recipient: NotificationRecipient;
  /** Source reminder type — drives priorityRank and the cap key (null for billing/system). */
  type: ReminderType | null;
  source: "REMINDER" | "BILLING" | "SYSTEM";
  channels: NotificationChannel[];
  title: string;
  body?: string;
  /** When the trigger condition held — ties in priority break by earliest trigger. */
  triggerTime: Date;
  /** True for child-addressed reminders the daily cap counts. */
  countsAgainstCap: boolean;
}

const DELIVERABLE_CHANNELS: ReadonlySet<NotificationChannel> = new Set(["PUSH", "EMAIL"]);

/** Priority rank for an intent; non-reminder intents sort after all ranked types. */
function intentRank(intent: NotificationIntent): number {
  return intent.type ? reminderPriorityRank(intent.type) : Number.MAX_SAFE_INTEGER;
}

/**
 * Evaluate intents for one sweep run and dispatch within the central daily cap.
 * Groups by (childId, capDay); for each child the capped intents compete for the
 * remaining daily budget by priority, the survivors are persisted PENDING and a
 * delivery job is enqueued per deliverable channel, and the rest are SUPPRESSED.
 * Non-capped intents (parent-only billing, childId-null) are always persisted PENDING.
 */
export async function buildAndDispatch(
  intents: NotificationIntent[],
  now: Date = new Date(),
): Promise<{ delivered: number; suppressed: number }> {
  const capDay = riyadhCapDay(now, config.PLATFORM_TZ_OFFSET_MINUTES);
  let delivered = 0;
  let suppressed = 0;

  // Partition: capped (child-addressed, countsAgainstCap) vs always-deliver.
  const capped = intents.filter((i) => i.countsAgainstCap && i.childId);
  const uncapped = intents.filter((i) => !(i.countsAgainstCap && i.childId));

  // Always-deliver intents first (they don't consume the cap budget).
  for (const intent of uncapped) {
    const row = await persistNotification(intent, null, "PENDING", now);
    if (row) {
      await enqueueChannels(row);
      delivered += 1;
    }
  }

  // Capped intents grouped by child, decided by priority within the remaining budget.
  const byChild = new Map<string, NotificationIntent[]>();
  for (const intent of capped) {
    const list = byChild.get(intent.childId!);
    if (list) list.push(intent);
    else byChild.set(intent.childId!, [intent]);
  }

  for (const [childId, childIntents] of byChild) {
    // Already-delivered/pending capped count for this child today (FR-010): retries
    // reuse rows, so this never inflates across idempotent sweeps.
    const alreadyCounted = await prisma.notification.count({
      where: {
        childId,
        capDay,
        countsAgainstCap: true,
        dispatchStatus: { in: ["PENDING", "SENT"] },
      },
    });
    let budget = Math.max(0, config.DAILY_NOTIFICATION_CAP - alreadyCounted);

    // Sort by priority rank, then earliest trigger time.
    const ordered = [...childIntents].sort((a, b) => {
      const r = intentRank(a) - intentRank(b);
      return r !== 0 ? r : a.triggerTime.getTime() - b.triggerTime.getTime();
    });

    for (const intent of ordered) {
      if (budget > 0) {
        const row = await persistNotification(intent, capDay, "PENDING", now);
        if (row) {
          await enqueueChannels(row);
          budget -= 1;
          delivered += 1;
        } else {
          // A unique-collision means this (child, day, type) was already delivered by an
          // earlier (idempotent) sweep — don't spend budget on a duplicate.
          logger.debug({ childId, type: intent.type }, "capped intent already dispatched — skip");
        }
      } else {
        // Over budget for the day: record as SUPPRESSED (auditable), not re-queued.
        await persistNotification(intent, capDay, "SUPPRESSED", now);
        suppressed += 1;
      }
    }
  }

  logger.info({ delivered, suppressed, capDay }, "dispatch complete");
  return { delivered, suppressed };
}

/**
 * Persist one Notification row. Returns the row, or null when a unique
 * (childId, capDay, type) collision means an idempotent sweep already created it.
 */
async function persistNotification(
  intent: NotificationIntent,
  capDay: string | null,
  dispatchStatus: "PENDING" | "SUPPRESSED",
  now: Date,
): Promise<Notification | null> {
  try {
    return await prisma.notification.create({
      data: {
        familyId: intent.familyId,
        childId: intent.childId,
        recipient: intent.recipient,
        title: intent.title,
        body: intent.body ?? null,
        type: intent.type,
        source: intent.source,
        priorityRank: intent.type ? reminderPriorityRank(intent.type) : 0,
        channels: intent.channels,
        capDay,
        countsAgainstCap: intent.countsAgainstCap && intent.childId != null,
        dispatchStatus,
        createdAt: now,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return null; // idempotent: a prior sweep already produced this (child,day,type)
    }
    throw err;
  }
}

/** Enqueue one delivery job per deliverable channel; WhatsApp degrades (FR-006). */
async function enqueueChannels(notification: Notification): Promise<void> {
  for (const channel of notification.channels) {
    if (!DELIVERABLE_CHANNELS.has(channel)) {
      // WhatsApp (and any future deferred channel) is skipped + logged, never errored.
      logger.info(
        { notificationId: notification.id, channel },
        "channel not yet supported — skipped (graceful degradation)",
      );
      continue;
    }
    await notificationsQueue().add(
      "deliver",
      { notificationId: notification.id, channel: channel as "PUSH" | "EMAIL" },
      { jobId: `${notification.id}-${channel}` }, // idempotent enqueue per channel
    );
  }
}

// ── Delivery support (consumed by notifications.worker) ───────────────────────

/** Load a notification row by id for the delivery worker. */
export async function getNotificationForDelivery(id: string): Promise<Notification | null> {
  return prisma.notification.findUnique({ where: { id } });
}

/** Active (non-disabled) push tokens for a notification's recipient, family-scoped. */
export async function tokensForNotification(
  notification: Notification,
): Promise<{ token: string; platform: PushPlatform }[]> {
  const tokens = await prisma.pushToken.findMany({
    where: {
      familyId: notification.familyId,
      disabledAt: null,
      ...(notification.recipient === "CHILD"
        ? { childId: notification.childId }
        : { childId: null }),
    },
    select: { token: true, platform: true },
  });
  return tokens;
}

/** Mark a notification SENT after a successful channel delivery (FR-010). */
export async function markSent(id: string, now: Date = new Date()): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { dispatchStatus: "SENT", sentAt: now },
  });
}

/** Record a transient failure attempt (BullMQ owns the retry/backoff). */
export async function recordAttempt(id: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { attemptCount: { increment: 1 } },
  });
}

/** Mark a notification DEAD_LETTERED after retries are exhausted (FR-010/026). */
export async function markDeadLettered(id: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { dispatchStatus: "DEAD_LETTERED" },
  });
}

/** Disable push tokens the provider reported invalid. */
export async function disableTokens(tokens: string[], now: Date = new Date()): Promise<void> {
  if (tokens.length === 0) return;
  await prisma.pushToken.updateMany({
    where: { token: { in: tokens } },
    data: { disabledAt: now },
  });
}

// ── Push-token registration (T031; notifications.controller calls these) ──────

export interface RegisterTokenArgs {
  familyId: string;
  /** Exactly one of parentId/childId is set, from the verified session principal. */
  parentId: string | null;
  childId: string | null;
  platform: PushPlatform;
  token: string;
}

/**
 * Register (or refresh) a device push token, idempotent on the token value. A token
 * already seen is rebound to the current owner and re-enabled; a new token is created.
 * Family scope comes from the verified session, never the request body (Principle I).
 */
export async function registerPushToken(
  args: RegisterTokenArgs,
): Promise<{ id: string; platform: PushPlatform; createdAt: Date }> {
  const existing = await prisma.pushToken.findUnique({ where: { token: args.token } });
  if (existing) {
    const updated = await prisma.pushToken.update({
      where: { token: args.token },
      data: {
        familyId: args.familyId,
        parentId: args.parentId,
        childId: args.childId,
        platform: args.platform,
        disabledAt: null,
      },
    });
    return { id: updated.id, platform: updated.platform, createdAt: updated.createdAt };
  }
  const created = await prisma.pushToken.create({
    data: {
      familyId: args.familyId,
      parentId: args.parentId,
      childId: args.childId,
      platform: args.platform,
      token: args.token,
    },
  });
  return { id: created.id, platform: created.platform, createdAt: created.createdAt };
}

/** Deregister a device token (idempotent; only within the caller's family). */
export async function deregisterPushToken(familyId: string, token: string): Promise<void> {
  await prisma.pushToken.deleteMany({ where: { familyId, token } });
}

// ── In-app notification feed (the dashboard bell) ─────────────────────────────
//
// The parent bell reads PARENT-addressed notifications for the family, newest first.
// Only delivered notices are shown (SUPPRESSED rows lost the daily-cap race and were
// never meant to surface; PENDING/SENT/FAILED are all real deliveries to the feed).

export interface NotificationView {
  id: string;
  title: string;
  body: string | null;
  source: Notification["source"];
  createdAt: Date;
  readAt: Date | null;
}

function toNotificationView(row: Notification): NotificationView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    source: row.source,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/**
 * List the family's PARENT-addressed notifications, newest first (family-scoped). Excludes
 * SUPPRESSED rows (cap-dropped, never surfaced). `unreadCount` drives the bell's badge.
 */
export async function listNotifications(
  familyId: string,
  limit = 50,
): Promise<{ notifications: NotificationView[]; unreadCount: number }> {
  const where = {
    familyId,
    recipient: "PARENT" as NotificationRecipient,
    dispatchStatus: { not: "SUPPRESSED" as const },
  };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { notifications: rows.map(toNotificationView), unreadCount };
}

/**
 * Mark one notification read (family-scoped, idempotent). A foreign/unknown id affects no
 * rows — reported as not-found so the client can't probe other families' ids.
 */
export async function markNotificationRead(familyId: string, id: string): Promise<void> {
  const result = await prisma.notification.updateMany({
    where: { id, familyId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    // Either already read (no-op) or not ours/unknown. Distinguish so a genuine 404 surfaces.
    const exists = await prisma.notification.findFirst({
      where: { id, familyId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError("Notification not found");
  }
}

/** Mark every unread PARENT notification in the family as read. Returns the count updated. */
export async function markAllNotificationsRead(familyId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { familyId, recipient: "PARENT", readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
