import { Worker, type Job } from "bullmq";
import pino from "pino";
import config from "../config/index.js";
import { queueConnection, QUEUE_NAMES, type SessionEventJobData } from "./queues.js";
import { processSessionEvent } from "../modules/sessionEvents/sessionEvents.service.js";

const logger = pino({ name: "sessionEvent.worker" });

// Consumes session-event jobs (contracts/session-event.schema.md). Validates the locked
// event, dedupes on eventId, and fans out to homework/progress/struggle derivations in
// one transaction — a duplicate eventId is a no-op (FR-002/018/022). Transient failures
// throw so BullMQ retries with backoff; exhausted jobs are retained (FR-026).

async function consume(job: Job<SessionEventJobData>): Promise<void> {
  const result = await processSessionEvent(job.data.event);
  logger.info({ jobId: job.id, ...result }, "session event processed");
}

export function createSessionEventWorker(): Worker<SessionEventJobData> {
  const worker = new Worker<SessionEventJobData>(QUEUE_NAMES.sessionEvents, consume, {
    connection: queueConnection(),
    concurrency: config.WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "session event failed (will retry)");
  });
  return worker;
}
