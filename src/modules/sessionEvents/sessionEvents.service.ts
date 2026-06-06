import pino from "pino";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { sessionEventSchema, type SessionEvent } from "./sessionEvents.schema.js";
import { applyHomeworkEvent, type HomeworkEventKind } from "../homework/homework.service.js";
import { deriveFromSession } from "../progress/progress.service.js";
import { buildAndDispatch, type NotificationIntent } from "../notifications/notifications.service.js";
import { goalMetIntentsForChild } from "../rewards/rewards.service.js";

const logger = pino({ name: "sessionEvents.service" });

// Locked session-event ingestion + exactly-once fan-out (FR-002/018/019/022,
// research.md §8). Validates the event (Principle III), records it in the
// ProcessedSessionEvent ledger (dedup on eventId), and applies homework transitions +
// progress/struggle derivations in ONE transaction. A duplicate eventId short-circuits
// with no effect. Struggle alerts produced inside the transaction are dispatched through
// the central dispatcher AFTER commit (cap-respecting).

export interface ProcessResult {
  status: "processed" | "duplicate" | "invalid";
  eventId?: string;
}

/**
 * Validate, dedupe, and apply a session event. Called by the sessionEvent worker.
 * Throws on transient DB failure (BullMQ retries); a duplicate or invalid event resolves
 * cleanly without throwing so it is not retried forever.
 */
export async function processSessionEvent(raw: unknown): Promise<ProcessResult> {
  const parsed = sessionEventSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "invalid session event — rejected");
    return { status: "invalid" };
  }
  const event = parsed.data;

  let struggleIntents: NotificationIntent[] = [];
  let duplicate = false;

  await prisma.$transaction(async (tx) => {
    // Ledger insert first; a unique violation means a duplicate delivery → no-op.
    try {
      await tx.processedSessionEvent.create({
        data: {
          eventId: event.eventId,
          childId: event.childId,
          familyId: event.familyId,
          outcome: event.outcome,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicate = true;
        return; // idempotent: first-seen already applied the effect
      }
      throw err;
    }

    await applyDerivations(tx, event);
    struggleIntents = await deriveFromSession(tx, event);

    await tx.processedSessionEvent.update({
      where: { eventId: event.eventId },
      data: { processedAt: new Date() },
    });
  });

  if (duplicate) {
    logger.info({ eventId: event.eventId }, "duplicate session event — no-op");
    return { status: "duplicate", eventId: event.eventId };
  }

  // Dispatch any struggle alerts + reward goal-met notifications through the central
  // dispatcher (post-commit so intents reflect committed progress; the dispatcher is
  // idempotent and cap-respecting). Reward goal-met raises the existing REWARD_REDEEMED
  // reminder — it NEVER changes reward status (Principle VI, research §4).
  const goalIntents = await goalMetIntentsForChild(event.familyId, event.childId);
  const intents = [...struggleIntents, ...goalIntents];
  if (intents.length > 0) {
    await buildAndDispatch(intents);
  }

  return { status: "processed", eventId: event.eventId };
}

/** Homework transitions driven by the event outcome (FR-015/018). */
async function applyDerivations(tx: Prisma.TransactionClient, event: SessionEvent): Promise<void> {
  const kind = homeworkKind(event);
  if (!kind) return; // abandoned: no homework transition
  await applyHomeworkEvent(tx, {
    familyId: event.familyId,
    childId: event.childId,
    subject: event.subject,
    topics: event.topics,
    kind,
    occurredAt: new Date(event.occurredAt),
    homeworkRef: event.homeworkRef,
  });
}

function homeworkKind(event: SessionEvent): HomeworkEventKind | null {
  if (event.outcome === "started") return "started";
  if (event.outcome === "completed") return "completed";
  return null; // abandoned
}

/**
 * Server-internal enqueue path for the AI pipeline producer (FR-019,
 * contracts/session-event.schema.md). No public client endpoint — the producer calls
 * this (authenticated server-side) to enqueue a session-events job; the worker then runs
 * `processSessionEvent`. Exported so the producer integration can import it directly.
 */
export async function enqueueSessionEvent(event: unknown): Promise<void> {
  const { sessionEventsQueue } = await import("../../jobs/queues.js");
  await sessionEventsQueue().add("ingest", { event });
}
