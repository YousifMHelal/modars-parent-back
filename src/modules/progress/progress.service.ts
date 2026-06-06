import pino from "pino";
import { Prisma } from "../../generated/prisma/client.js";
import type { Trend } from "../../generated/prisma/client.js";
import config from "../../config/index.js";
import type { NotificationIntent } from "../notifications/notifications.service.js";
import type { SessionEvent } from "../sessionEvents/sessionEvents.schema.js";

const logger = pino({ name: "progress.service" });

// Server-authoritative progress + struggle derivation from session events (FR-020/021/
// 022, research.md §6). Runs INSIDE the session-event transaction (sessionEvents.service)
// so it is exactly-once. Updates SubjectProgress/TopicProgress + the Child snapshot, and
// maintains the per-(child,topic) consecutive-low-mastery counter; reaching the threshold
// flags TopicProgress.struggling and returns a struggle-alert intent for the dispatcher.

type Tx = Prisma.TransactionClient;

const LEVEL_XP_SPAN = 1000; // xp per level (mirrors Child.levelMax default)

function trendFor(history: number[], latest: number): Trend {
  const prev = history.length > 0 ? history[history.length - 1]! : latest;
  if (latest > prev) return "UP";
  if (latest < prev) return "DOWN";
  return "FLAT";
}

/**
 * Apply a completed/started session's progress effects and detect struggle. Abandoned
 * sessions still record time but earn no XP. Returns any struggle-alert intents raised
 * this event (routed through the central dispatcher by the caller, cap-respecting).
 */
export async function deriveFromSession(
  tx: Tx,
  event: SessionEvent,
): Promise<NotificationIntent[]> {
  const occurredAt = new Date(event.occurredAt);

  // ── Child snapshot (totalXp, level/levelXp, minutes, lastStudiedAt) ──
  const child = await tx.child.findFirst({
    where: { id: event.childId, familyId: event.familyId },
    select: { id: true, totalXp: true, levelXp: true, level: true, totalMinutes: true, minutesThisWeek: true },
  });
  if (!child) {
    logger.warn({ childId: event.childId }, "session event for unknown child — skipping progress");
    return [];
  }

  const newTotalXp = child.totalXp + event.xpEarned;
  let level = child.level;
  let levelXp = child.levelXp + event.xpEarned;
  while (levelXp >= LEVEL_XP_SPAN) {
    levelXp -= LEVEL_XP_SPAN;
    level += 1;
  }

  await tx.child.update({
    where: { id: child.id },
    data: {
      totalXp: newTotalXp,
      level,
      levelXp,
      nextLevel: level + 1,
      totalMinutes: child.totalMinutes + event.durationMinutes,
      minutesThisWeek: child.minutesThisWeek + event.durationMinutes,
    },
  });

  // ── Subject + topic progress, per touched topic ──
  const subjectMastery = averageMastery(event);
  const subjectProgress = await upsertSubjectProgress(tx, event, subjectMastery, occurredAt);

  const struggleIntents: NotificationIntent[] = [];
  for (const topic of event.topics) {
    const mastery = event.masteryByTopic[topic];
    if (mastery === undefined) continue;
    await upsertTopicProgress(tx, subjectProgress.id, topic, mastery);
    const intent = await applyStruggle(tx, event, topic, mastery, subjectProgress.id, occurredAt);
    if (intent) struggleIntents.push(intent);
  }

  return struggleIntents;
}

function averageMastery(event: SessionEvent): number {
  const values = event.topics.map((t) => event.masteryByTopic[t] ?? 0);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function upsertSubjectProgress(
  tx: Tx,
  event: SessionEvent,
  mastery: number,
  occurredAt: Date,
): Promise<{ id: string }> {
  const existing = await tx.subjectProgress.findFirst({
    where: { childId: event.childId, subject: event.subject },
    select: { id: true, masteryHistory: true },
  });

  if (existing) {
    const history = [...existing.masteryHistory, mastery].slice(-12);
    const updated = await tx.subjectProgress.update({
      where: { id: existing.id },
      data: {
        mastery,
        trend: trendFor(existing.masteryHistory, mastery),
        lastStudiedAt: occurredAt,
        masteryHistory: history,
      },
      select: { id: true },
    });
    return updated;
  }

  const created = await tx.subjectProgress.create({
    data: {
      familyId: event.familyId,
      childId: event.childId,
      subject: event.subject,
      mastery,
      coverage: 0,
      trend: "FLAT",
      lastStudiedAt: occurredAt,
      masteryHistory: [mastery],
    },
    select: { id: true },
  });
  return created;
}

async function upsertTopicProgress(
  tx: Tx,
  subjectProgressId: string,
  name: string,
  mastery: number,
): Promise<void> {
  const existing = await tx.topicProgress.findFirst({
    where: { subjectProgressId, name },
    select: { id: true },
  });
  if (existing) {
    await tx.topicProgress.update({ where: { id: existing.id }, data: { mastery } });
  } else {
    await tx.topicProgress.create({
      data: { subjectProgressId, name, mastery, struggling: false },
    });
  }
}

/**
 * Maintain the consecutive-low-mastery counter for (child, topic) and raise a struggle
 * alert at the threshold (FR-021). Below threshold → increment; at/above → reset to 0.
 * On reaching STRUGGLE_CONSECUTIVE_THRESHOLD: flag TopicProgress.struggling and return a
 * STRUGGLE_ALERT intent, debounced by lastAlertedAt so it doesn't fire every session.
 */
async function applyStruggle(
  tx: Tx,
  event: SessionEvent,
  topic: string,
  mastery: number,
  subjectProgressId: string,
  occurredAt: Date,
): Promise<NotificationIntent | null> {
  const low = mastery < config.STRUGGLE_MASTERY_THRESHOLD;

  const tracker = await tx.struggleTracker.findFirst({
    where: { childId: event.childId, topic },
  });
  const current = tracker?.consecutiveLowMastery ?? 0;
  const nextCount = low ? current + 1 : 0;

  await tx.struggleTracker.upsert({
    where: { childId_topic: { childId: event.childId, topic } },
    create: {
      familyId: event.familyId,
      childId: event.childId,
      topic,
      consecutiveLowMastery: nextCount,
    },
    update: { consecutiveLowMastery: nextCount },
  });

  if (!low || nextCount < config.STRUGGLE_CONSECUTIVE_THRESHOLD) {
    // Recovered or not yet struggling — clear the topic flag when recovered.
    if (!low) {
      await tx.topicProgress.updateMany({
        where: { subjectProgressId, name: topic },
        data: { struggling: false },
      });
    }
    return null;
  }

  // At/over the threshold: flag the topic and (debounced) raise the alert.
  await tx.topicProgress.updateMany({
    where: { subjectProgressId, name: topic },
    data: { struggling: true },
  });

  const alreadyAlerted = tracker?.lastAlertedAt != null;
  if (alreadyAlerted) return null; // debounce until the counter resets and re-triggers

  await tx.struggleTracker.update({
    where: { childId_topic: { childId: event.childId, topic } },
    data: { lastAlertedAt: occurredAt },
  });

  // Parent-addressed struggle alert about the child. Routed through the central
  // dispatcher by the caller; the cap applies where child-addressed (this one is
  // parent-addressed and informs about a struggle, default rank from STRUGGLE_ALERT).
  return {
    familyId: event.familyId,
    childId: event.childId,
    recipient: "PARENT",
    type: "STRUGGLE_ALERT",
    source: "REMINDER",
    channels: ["PUSH", "EMAIL"],
    title: "Struggle alert",
    body: `Repeated difficulty on ${topic}`,
    triggerTime: occurredAt,
    countsAgainstCap: false,
  };
}
