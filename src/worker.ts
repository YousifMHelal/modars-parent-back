import pino from "pino";
import config from "./config/index.js";
import { connect, disconnect } from "./db/prisma.js";
import { startWorkers, shutdownWorkers } from "./jobs/index.js";
import { registerRepeatableJobs } from "./jobs/scheduler.js";

// The Phase 6 worker process (research.md §1). Separate from the web process: web
// only enqueues, this boots every BullMQ worker and registers the repeatable sweeps.
// Each worker logs via pino (FR-026); shutdown drains workers + queues gracefully.

const logger = pino({
  name: "worker",
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
});

async function main(): Promise<void> {
  logger.info("Starting worker process...");

  await connect();
  logger.info("Prisma connected");

  startWorkers();
  await registerRepeatableJobs();
  logger.info("Workers running");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down workers...");
    await shutdownWorkers();
    await disconnect();
    logger.info("Worker process closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal (worker): ${message}\n`);
  process.exit(1);
});
