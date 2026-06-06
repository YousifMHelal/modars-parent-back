import pino from "pino";
import { Prisma } from "../../generated/prisma/client.js";
import type { Homework, HomeworkStatus } from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";

const logger = pino({ name: "homework.service" });

// Server-authoritative homework state machine (FR-015–018, research.md §5). Transitions
// are a pure function of (currentStatus, event kind, deadline, occurredAt); the client
// never sets status (FR-017). Event-driven transitions run inside the session-event
// transaction (idempotent via the processed-event ledger); the time-driven OVERDUE
// transition runs in the reminders/deadline sweep, guarded to fire once.

export type HomeworkEventKind = "started" | "completed";

/**
 * Pure transition. Returns the next status, or null when the event does not move the
 * item (out-of-order or terminal-state events are no-ops, not regressions):
 *   PENDING --started--> IN_PROGRESS
 *   {PENDING,IN_PROGRESS} --completed (occurredAt <= deadline)--> COMPLETED
 *   {PENDING,IN_PROGRESS} --completed (occurredAt >  deadline)--> COMPLETED_LATE
 *   OVERDUE --completed--> COMPLETED_LATE (always late once overdue)
 * Completed/Completed-Late are terminal (a later `started` does not regress them).
 */
export function transition(
  current: HomeworkStatus,
  kind: HomeworkEventKind,
  deadline: Date,
  occurredAt: Date,
): HomeworkStatus | null {
  // Terminal states never regress.
  if (current === "COMPLETED" || current === "COMPLETED_LATE") return null;

  if (kind === "started") {
    return current === "PENDING" ? "IN_PROGRESS" : null;
  }

  // kind === "completed": the boundary is resolved against the recorded deadline, not
  // wall-clock. occurredAt == deadline counts as on-time.
  const late = occurredAt.getTime() > deadline.getTime() || current === "OVERDUE";
  return late ? "COMPLETED_LATE" : "COMPLETED";
}

type Tx = Prisma.TransactionClient;

/**
 * Apply a session event's homework effect inside the session-event transaction. Matches
 * the relevant homework by `homeworkRef` (if given and in-family) else by
 * (childId, subject, topic); applies the pure transition if it moves the item. A no-op
 * transition (or no matching item) leaves homework untouched (FR-015/016/018).
 */
export async function applyHomeworkEvent(
  tx: Tx,
  args: {
    familyId: string;
    childId: string;
    subject: string;
    topics: string[];
    kind: HomeworkEventKind;
    occurredAt: Date;
    homeworkRef?: string | undefined;
  },
): Promise<void> {
  const item = await matchHomework(tx, args);
  if (!item) return;

  const next = transition(item.status, args.kind, item.deadline, args.occurredAt);
  if (!next || next === item.status) return;

  await tx.homework.update({ where: { id: item.id }, data: { status: next } });
  logger.info(
    { homeworkId: item.id, from: item.status, to: next, childId: args.childId },
    "homework transition",
  );
}

async function matchHomework(
  tx: Tx,
  args: { familyId: string; childId: string; subject: string; topics: string[]; homeworkRef?: string | undefined },
): Promise<Homework | null> {
  if (args.homeworkRef) {
    const byRef = await tx.homework.findFirst({
      where: { id: args.homeworkRef, familyId: args.familyId, childId: args.childId },
    });
    if (byRef) return byRef;
  }
  // Fall back to (childId, subject, topic) — the first unfinished match across topics.
  return tx.homework.findFirst({
    where: {
      familyId: args.familyId,
      childId: args.childId,
      subject: args.subject,
      topic: { in: args.topics },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    orderBy: { deadline: "asc" },
  });
}

/**
 * Time-driven OVERDUE transition (FR-016): items past their deadline still PENDING or
 * IN_PROGRESS become OVERDUE. Guarded by the status filter so it fires once. Returns the
 * number of items moved. Called from the reminders/deadline sweep.
 */
export async function sweepOverdueHomework(now: Date = new Date()): Promise<number> {
  const result = await prisma.homework.updateMany({
    where: { deadline: { lt: now }, status: { in: ["PENDING", "IN_PROGRESS"] } },
    data: { status: "OVERDUE" },
  });
  if (result.count > 0) {
    logger.info({ count: result.count }, "homework marked overdue");
  }
  return result.count;
}
