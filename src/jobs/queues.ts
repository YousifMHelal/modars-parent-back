import { Queue, type JobsOptions, type ConnectionOptions } from "bullmq";
import config from "../config/index.js";

// ── BullMQ queue + connection definitions (contracts/job-payloads.md) ─────────
//
// The web process (server.ts) only ENQUEUES; the worker process (worker.ts)
// processes. Both share these queue names so payloads line up. BullMQ requires its
// blocking connection to have `maxRetriesPerRequest: null` (distinct from the app's
// health-checking Redis client in db/redis.ts), so we mint a dedicated connection here.

export const QUEUE_NAMES = {
  sessionEvents: "session-events",
  notifications: "notifications",
  remindersSweep: "reminders-sweep",
  childPurge: "child-purge",
  subscriptionPurge: "subscription-purge",
  familyPurge: "family-purge",
  dataExport: "data-export",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ connection options (queues and workers each create their own connection from
 * these). We hand BullMQ the URL + required `maxRetriesPerRequest: null` rather than a
 * pre-built ioredis instance so it uses its own bundled ioredis (avoids a dual-copy
 * type/runtime mismatch).
 */
export function queueConnection(): ConnectionOptions {
  return { url: config.REDIS_URL, maxRetriesPerRequest: null };
}

// Default job options applied to every enqueue (FR-001/002/010/026): bounded
// exponential backoff and retention of completed/failed jobs so an exhausted job is
// kept as a dead-letter for inspection rather than silently dropped (FR-026).
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: false, // keep failed jobs (dead-letter equivalent) for inspection
};

// Queues are created LAZILY on first access and cached, so merely importing this module
// (or the services that re-export it) does not open a Redis connection — only an actual
// enqueue does. This keeps unit tests that never enqueue free of Redis, and avoids
// leaking idle connections across test runs.
const queueCache = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queueCache.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: queueConnection(), defaultJobOptions });
    queueCache.set(name, queue);
  }
  return queue;
}

export const sessionEventsQueue = (): Queue => getQueue(QUEUE_NAMES.sessionEvents);
export const notificationsQueue = (): Queue => getQueue(QUEUE_NAMES.notifications);
export const remindersSweepQueue = (): Queue => getQueue(QUEUE_NAMES.remindersSweep);
export const childPurgeQueue = (): Queue => getQueue(QUEUE_NAMES.childPurge);
export const subscriptionPurgeQueue = (): Queue => getQueue(QUEUE_NAMES.subscriptionPurge);
export const familyPurgeQueue = (): Queue => getQueue(QUEUE_NAMES.familyPurge);
export const dataExportQueue = (): Queue => getQueue(QUEUE_NAMES.dataExport);

/** All instantiated queues (for graceful shutdown). */
export function instantiatedQueues(): Queue[] {
  return [...queueCache.values()];
}

/** Close every instantiated queue's connection (worker shutdown / test teardown). */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queueCache.values()].map((q) => q.close()));
  queueCache.clear();
}

// ── Payload types (contracts/job-payloads.md) ─────────────────────────────────

export interface NotificationJobData {
  notificationId: string;
  channel: "PUSH" | "EMAIL";
}

/** Sweeps accept an optional injected `now` (ISO) for deterministic runs/tests. */
export interface SweepJobData {
  now?: string;
}

/** The locked session event is carried verbatim; validated at the worker boundary. */
export interface SessionEventJobData {
  event: unknown;
}

/** Phase 8 data-export assembly job (contracts/job-payloads.md §2). */
export interface DataExportJobData {
  exportId: string;
  familyId: string;
}
