import pino from "pino";
import config from "../config/index.js";
import {
  remindersSweepQueue,
  childPurgeQueue,
  subscriptionPurgeQueue,
} from "./queues.js";

const logger = pino({ name: "scheduler" });

// Registers the repeatable (cron-like) jobs (contracts/job-payloads.md). BullMQ's
// repeatable scheduler enqueues each on its cron pattern; the patterns come from config
// (REMINDERS_SWEEP_CRON every 15m, PURGE_SWEEP_CRON hourly). Re-registering with the
// same name+pattern is idempotent, so booting multiple worker processes is safe.

export async function registerRepeatableJobs(): Promise<void> {
  await remindersSweepQueue().add(
    "sweep",
    {},
    { repeat: { pattern: config.REMINDERS_SWEEP_CRON }, jobId: "reminders-sweep" },
  );
  await childPurgeQueue().add(
    "sweep",
    {},
    { repeat: { pattern: config.PURGE_SWEEP_CRON }, jobId: "child-purge" },
  );
  await subscriptionPurgeQueue().add(
    "sweep",
    {},
    { repeat: { pattern: config.PURGE_SWEEP_CRON }, jobId: "subscription-purge" },
  );

  logger.info(
    {
      remindersCron: config.REMINDERS_SWEEP_CRON,
      purgeCron: config.PURGE_SWEEP_CRON,
    },
    "repeatable jobs registered",
  );
}
