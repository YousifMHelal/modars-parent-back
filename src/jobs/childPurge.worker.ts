import { Worker, type Job } from "bullmq";
import pino from "pino";
import { queueConnection, QUEUE_NAMES, type SweepJobData } from "./queues.js";
import { purgeDueSoftDeleted } from "../modules/children/children.service.js";

const logger = pino({ name: "childPurge.worker" });

// The hourly child-purge sweep (FR-012–014/026): permanently removes children past
// their 7-day soft-delete window, releasing the username. The service re-checks restore
// state in-tx and is idempotent. Thin: logic lives in the children service.

async function sweep(job: Job<SweepJobData>): Promise<void> {
  const now = job.data.now ? new Date(job.data.now) : new Date();
  const purgedIds = await purgeDueSoftDeleted(now);
  logger.info({ purgedCount: purgedIds.length, purgedIds }, "child purge complete");
}

export function createChildPurgeWorker(): Worker<SweepJobData> {
  const worker = new Worker<SweepJobData>(QUEUE_NAMES.childPurge, sweep, {
    connection: queueConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "child purge failed (will retry)");
  });
  return worker;
}
