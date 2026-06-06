import { Worker, type Job, UnrecoverableError } from "bullmq";
import pino from "pino";
import config from "../config/index.js";
import { queueConnection, QUEUE_NAMES, type NotificationJobData } from "./queues.js";
import * as service from "../modules/notifications/notifications.service.js";
import { send as sendEmail } from "../lib/mailer.js";
import { getPushProvider } from "../lib/push.js";

const logger = pino({ name: "notifications.worker" });

// Delivers one Notification on one channel (contracts/job-payloads.md). Loads the row
// (the cap was already decided centrally), delivers via lib/push or lib/mailer, sets
// SENT/sentAt on success. A transient failure throws so BullMQ retries with backoff;
// on the final attempt the row is marked DEAD_LETTERED (FR-010/026). The row is REUSED
// across attempts, so the daily cap is never recounted (FR-010).

async function deliver(job: Job<NotificationJobData>): Promise<void> {
  const { notificationId, channel } = job.data;
  const notification = await service.getNotificationForDelivery(notificationId);
  if (!notification) {
    // The row vanished (e.g. child purged) — nothing to deliver, don't retry.
    throw new UnrecoverableError(`notification ${notificationId} not found`);
  }
  if (notification.dispatchStatus === "SENT") {
    return; // already delivered (idempotent re-run)
  }

  await service.recordAttempt(notificationId);

  if (channel === "EMAIL") {
    // The family's parent email addressing is resolved by the mailer recipient; here we
    // log-deliver via the stub. A real transport throws on transient failure → retry.
    sendEmail({
      to: notification.familyId, // stub keys off family; real transport resolves address
      subject: notification.title,
      text: notification.body ?? notification.title,
    });
    await service.markSent(notificationId);
    return;
  }

  // PUSH
  const targets = await service.tokensForNotification(notification);
  if (targets.length === 0) {
    // No device registered for this recipient — nothing to deliver; mark SENT so we
    // don't retry forever (the notification still backs the in-app unread count).
    logger.info({ notificationId }, "no push tokens for recipient — marking sent (no-op)");
    await service.markSent(notificationId);
    return;
  }

  const result = await getPushProvider().send(targets, {
    title: notification.title,
    body: notification.body ?? notification.title,
  });
  if (result.invalidTokens.length > 0) {
    await service.disableTokens(result.invalidTokens);
  }
  await service.markSent(notificationId);
}

export function createNotificationsWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(QUEUE_NAMES.notifications, deliver, {
    connection: queueConnection(),
    concurrency: config.WORKER_CONCURRENCY,
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, ...job.data }, "notification delivered");
  });
  worker.on("failed", (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts.attempts ?? 0;
    const exhausted = attemptsMade >= maxAttempts;
    logger.warn(
      { jobId: job?.id, ...(job?.data ?? {}), err: err.message, attemptsMade, exhausted },
      exhausted ? "notification delivery dead-lettered" : "notification delivery failed (will retry)",
    );
    if (exhausted && job?.data.notificationId) {
      void service.markDeadLettered(job.data.notificationId);
    }
  });

  return worker;
}
