import { Worker, type Job } from "bullmq";
import pino from "pino";
import { queueConnection, QUEUE_NAMES, type SweepJobData } from "./queues.js";
import { purgeDueDeletedFamilies, expireDueExports } from "../modules/settings/settings.service.js";

const logger = pino({ name: "familyPurge.worker" });

// The hourly family-purge sweep (FR-008/011–014, contracts/job-payloads.md §1):
// permanently removes families past their ACCOUNT_RETAIN_DAYS retain window, releasing
// child usernames, and expires READY exports past their TTL (job-payloads §3). The service
// re-checks cancel state in-tx and is idempotent. Thin: logic lives in the settings service.

async function sweep(job: Job<SweepJobData>): Promise<void> {
  const now = job.data.now ? new Date(job.data.now) : new Date();
  const purgedIds = await purgeDueDeletedFamilies(now);
  const expiredIds = await expireDueExports(now);
  logger.info(
    { purgedCount: purgedIds.length, purgedIds, expiredCount: expiredIds.length },
    "family purge + export expiry complete",
  );
}

export function createFamilyPurgeWorker(): Worker<SweepJobData> {
  const worker = new Worker<SweepJobData>(QUEUE_NAMES.familyPurge, sweep, {
    connection: queueConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "family purge failed (will retry)");
  });
  return worker;
}
