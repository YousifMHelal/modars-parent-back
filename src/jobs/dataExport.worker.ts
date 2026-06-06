import { Worker, type Job } from "bullmq";
import pino from "pino";
import config from "../config/index.js";
import { queueConnection, QUEUE_NAMES, type DataExportJobData } from "./queues.js";
import { assembleDataExport } from "../modules/settings/settings.service.js";

const logger = pino({ name: "dataExport.worker" });

// On-demand data-export assembly (FR-001/002, contracts/job-payloads.md §2). Enqueued by
// requestDataExport. Assembles + gzips + stores the family-scoped bundle and flips the
// DataExport PENDING→READY (or FAILED). Thin: logic lives in the settings service.

async function assemble(job: Job<DataExportJobData>): Promise<void> {
  await assembleDataExport(job.data.exportId);
  logger.info({ jobId: job.id, exportId: job.data.exportId }, "data export job processed");
}

export function createDataExportWorker(): Worker<DataExportJobData> {
  const worker = new Worker<DataExportJobData>(QUEUE_NAMES.dataExport, assemble, {
    connection: queueConnection(),
    concurrency: config.WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "data export failed (will retry)");
  });
  return worker;
}
