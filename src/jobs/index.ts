import type { Worker } from "bullmq";
import pino from "pino";
import { createNotificationsWorker } from "./notifications.worker.js";
import { createRemindersWorker } from "./reminders.worker.js";
import { createSessionEventWorker } from "./sessionEvent.worker.js";
import { createChildPurgeWorker } from "./childPurge.worker.js";
import { createSubscriptionPurgeWorker } from "./subscriptionPurge.worker.js";
import { createFamilyPurgeWorker } from "./familyPurge.worker.js";
import { createDataExportWorker } from "./dataExport.worker.js";
import { closeQueues } from "./queues.js";

const logger = pino({ name: "jobs" });

// Worker registry + lifecycle (contracts/job-payloads.md). Default job options
// (attempts/backoff/retention) live on the queues (queues.ts); each worker factory
// wires its own concurrency and failed-job logging (dead-letter equivalent — FR-026).
// `startWorkers` boots every queue's worker; `shutdownWorkers` drains them gracefully.

type WorkerFactory = () => Worker;

const WORKER_FACTORIES: WorkerFactory[] = [
  createNotificationsWorker,
  createRemindersWorker,
  createSessionEventWorker,
  createChildPurgeWorker,
  createSubscriptionPurgeWorker,
  createFamilyPurgeWorker,
  createDataExportWorker,
];

let workers: Worker[] = [];

export function startWorkers(): Worker[] {
  workers = WORKER_FACTORIES.map((create) => create());
  logger.info({ count: workers.length }, "workers started");
  return workers;
}

export async function shutdownWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  logger.info("workers and queues closed");
}
