import { Worker, type Job } from "bullmq";
import pino from "pino";
import { queueConnection, QUEUE_NAMES, type SweepJobData } from "./queues.js";
import { purgeDueCanceled } from "../modules/billing/billing.service.js";

const logger = pino({ name: "subscriptionPurge.worker" });

// The hourly subscription-purge sweep (FR-023/026): permanently removes canceled
// subscriptions past their canceledEffectiveAt retain deadline, idempotently. Thin:
// logic lives in the billing service.

async function sweep(job: Job<SweepJobData>): Promise<void> {
  const now = job.data.now ? new Date(job.data.now) : new Date();
  const purgedIds = await purgeDueCanceled(now);
  logger.info({ purgedCount: purgedIds.length, purgedIds }, "subscription purge complete");
}

export function createSubscriptionPurgeWorker(): Worker<SweepJobData> {
  const worker = new Worker<SweepJobData>(QUEUE_NAMES.subscriptionPurge, sweep, {
    connection: queueConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "subscription purge failed (will retry)");
  });
  return worker;
}
