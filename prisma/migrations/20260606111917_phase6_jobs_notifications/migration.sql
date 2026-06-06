-- Phase 6: Background Jobs & Notifications Engine (additive — data-model.md)

-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('REMINDER', 'BILLING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('FCM', 'APNS');

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "capDay" TEXT,
ADD COLUMN     "channels" "NotificationChannel"[],
ADD COLUMN     "countsAgainstCap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dispatchStatus" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "priorityRank" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "source" "NotificationSource" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "type" "ReminderType";

-- Backfill existing Notification rows (data-model.md §I): they were already delivered
-- under Phase 1–5, so mark them SENT and not counted against the new daily cap. capDay
-- stays NULL (not retroactively capped) and source stays SYSTEM (column default).
UPDATE "Notification"
SET "dispatchStatus" = 'SENT',
    "countsAgainstCap" = false,
    "source" = 'SYSTEM',
    "capDay" = NULL
WHERE "dispatchStatus" = 'PENDING';

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "parentId" TEXT,
    "childId" TEXT,
    "platform" "PushPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedSessionEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessedSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StruggleTracker" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "consecutiveLowMastery" INTEGER NOT NULL DEFAULT 0,
    "lastAlertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StruggleTracker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushToken_familyId_idx" ON "PushToken"("familyId");

-- CreateIndex
CREATE INDEX "PushToken_childId_idx" ON "PushToken"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedSessionEvent_eventId_key" ON "ProcessedSessionEvent"("eventId");

-- CreateIndex
CREATE INDEX "ProcessedSessionEvent_eventId_idx" ON "ProcessedSessionEvent"("eventId");

-- CreateIndex
CREATE INDEX "ProcessedSessionEvent_childId_idx" ON "ProcessedSessionEvent"("childId");

-- CreateIndex
CREATE INDEX "StruggleTracker_familyId_idx" ON "StruggleTracker"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "StruggleTracker_childId_topic_key" ON "StruggleTracker"("childId", "topic");

-- CreateIndex
CREATE INDEX "Child_purgeAfter_idx" ON "Child"("purgeAfter");

-- CreateIndex
CREATE INDEX "Notification_childId_capDay_idx" ON "Notification"("childId", "capDay");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_childId_capDay_type_key" ON "Notification"("childId", "capDay", "type");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StruggleTracker" ADD CONSTRAINT "StruggleTracker_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
