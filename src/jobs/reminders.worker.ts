import { Worker, type Job } from "bullmq";
import pino from "pino";
import { queueConnection, QUEUE_NAMES, type SweepJobData } from "./queues.js";
import { runRemindersSweep } from "../modules/reminders/reminders.service.js";

const logger = pino({ name: "reminders.worker" });

// The repeatable reminders/deadline sweep (FR-026). Evaluates every active child's
// reminder triggers and the time-driven homework OVERDUE transition, then routes all
// produced intents through the central dispatcher (the cap is applied there). Thin:
// all logic lives in services (Principle II).

async function sweep(job: Job<SweepJobData>): Promise<void> {
  const now = job.data.now ? new Date(job.data.now) : new Date();
  const result = await runRemindersSweep(now);
  logger.info({ ...result, now: now.toISOString() }, "reminders sweep complete");
}

export function createRemindersWorker(): Worker<SweepJobData> {
  const worker = new Worker<SweepJobData>(QUEUE_NAMES.remindersSweep, sweep, {
    connection: queueConnection(),
    concurrency: 1, // a single sweep at a time is sufficient and avoids contention
  });
  worker.on("failed", (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, "reminders sweep failed (will retry)");
  });
  return worker;
}
