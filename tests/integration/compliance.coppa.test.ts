import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../../src/db/prisma.js";
import { recordConsent } from "../../src/lib/consent.js";
import {
  buildAndDispatch,
  type NotificationIntent,
} from "../../src/modules/notifications/notifications.service.js";
import config from "../../src/config/index.js";
import type { ReminderType } from "../../src/generated/prisma/client.js";

// COPPA carry-forward verification (FR-015/016, SC-006, research.md §6). These constraints
// are satisfied by earlier-phase design; Phase 8 LOCKS them with regression tests so they
// cannot silently regress.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");

describe("FR-015: no raw under-13 audio is ever stored", () => {
  it("the Prisma schema declares no audio/recording bytes column or storage key", () => {
    const schema = fs.readFileSync(schemaPath, "utf-8");
    // Strip the chat MessageType enum value VOICE (a message KIND, not stored audio bytes)
    // before scanning, then assert no audio/recording field is persisted anywhere.
    const withoutVoiceEnum = schema.replace(/^\s*VOICE\s*$/m, "");
    expect(/audioUrl|audioKey|recordingUrl|recordingKey|rawAudio/i.test(withoutVoiceEnum)).toBe(
      false,
    );
  });

  it("the session-event ingest schema accepts transcripts/metrics only — no audio bytes", () => {
    const sePath = path.resolve(
      __dirname,
      "../../src/modules/sessionEvents/sessionEvents.schema.ts",
    );
    const src = fs.readFileSync(sePath, "utf-8");
    expect(/audio|recording|waveform|\.wav|\.mp3/i.test(src)).toBe(false);
  });
});

describe("FR-016: the central per-child daily notification cap holds", () => {
  let familyId: string;
  let childId: string;

  const NOW = new Date("2026-06-06T08:00:00.000Z");

  const intent = (type: ReminderType): NotificationIntent => ({
    familyId,
    childId,
    recipient: "CHILD",
    type,
    source: "REMINDER",
    channels: ["PUSH"],
    title: `${type}`,
    triggerTime: NOW,
    countsAgainstCap: true,
  });

  beforeEach(async () => {
    const family = await prisma.family.create({ data: { name: "coppa-cap-family" } });
    familyId = family.id;
    // COPPA consent so the (separately tested) ingest gate is not the thing under test here.
    await recordConsent(prisma, { familyId, type: "COPPA", version: "1.0" });
    const uniq = Math.random().toString(36).slice(2, 10);
    const child = await prisma.child.create({
      data: {
        familyId,
        displayName: "Cap Child",
        dob: new Date("2014-01-01"),
        gender: "MALE",
        country: "SA",
        grade: "Grade 5",
        curriculum: "BRITISH",
        subjects: ["Mathematics"],
        username: `coppa_${uniq}`,
        usernameNormalized: `coppa_${uniq}`,
      },
    });
    childId = child.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { familyId } });
    await prisma.consentRecord.deleteMany({ where: { familyId } });
    await prisma.child.deleteMany({ where: { familyId } });
    await prisma.family.deleteMany({ where: { id: familyId } });
  });

  it(`never delivers more than DAILY_NOTIFICATION_CAP (${config.DAILY_NOTIFICATION_CAP}) capped notifications/child/day`, async () => {
    await buildAndDispatch(
      [
        intent("MISSED_SESSION"),
        intent("STRUGGLE_ALERT"),
        intent("HOMEWORK_DUE"),
        intent("DAILY_STUDY"),
        intent("REWARD_REDEEMED"),
        intent("EXAM_COUNTDOWN"),
      ],
      NOW,
    );
    const delivered = await prisma.notification.count({
      where: { childId, countsAgainstCap: true, dispatchStatus: { in: ["PENDING", "SENT"] } },
    });
    expect(delivered).toBe(config.DAILY_NOTIFICATION_CAP);
  });
});
