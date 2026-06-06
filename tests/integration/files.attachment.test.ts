import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import storage from "../../src/lib/storage.js";
import { attachmentKey, attachmentRef } from "../../src/lib/storageKeys.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintFamilyBOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await setupWriteFixture("FAMILY");
});

afterEach(async () => {
  await prisma.message.deleteMany({ where: { conversation: { familyId: { in: [fx.familyAId, fx.familyBId] } } } });
  await prisma.conversation.deleteMany({ where: { familyId: { in: [fx.familyAId, fx.familyBId] } } });
  await teardownWriteFixture();
});

async function seedAttachment(familyId: string, filename: string): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: { familyId, subject: "General" },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: "PARENT",
      type: "IMAGE",
      attachmentUrl: attachmentRef("placeholder", filename),
    },
  });
  // Now we know the messageId — store the bytes under the real key and fix the ref.
  await storage.put(attachmentKey(familyId, message.id, filename), Buffer.from("file-bytes"), "image/png");
  await prisma.message.update({
    where: { id: message.id },
    data: { attachmentUrl: attachmentRef(message.id, filename) },
  });
  return message.id;
}

describe("GET /files/attachments/:messageId/:filename (US3)", () => {
  it("serves a stored attachment to the owning family", async () => {
    const messageId = await seedAttachment(fx.familyAId, "photo.png");
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/files/attachments/${messageId}/photo.png`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("denies cross-family access → 403", async () => {
    const messageId = await seedAttachment(fx.familyAId, "photo.png");
    const foreign = await mintFamilyBOwnerToken(fx);
    const res = await request(app)
      .get(`/files/attachments/${messageId}/photo.png`)
      .set("Authorization", `Bearer ${foreign}`);
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request → 401", async () => {
    const messageId = await seedAttachment(fx.familyAId, "photo.png");
    const res = await request(app).get(`/files/attachments/${messageId}/photo.png`);
    expect(res.status).toBe(401);
  });

  it("denies a guessed/mismatched filename → 404", async () => {
    const messageId = await seedAttachment(fx.familyAId, "photo.png");
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/files/attachments/${messageId}/secret.png`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
