import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import storage from "../../src/lib/storage.js";
import { exportKey } from "../../src/lib/storageKeys.js";
import {
  assembleDataExport,
  expireDueExports,
} from "../../src/modules/settings/settings.service.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintChildToken,
  mintFamilyBOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US2 — data export (FR-001–004/025, SC-001/002). Request → assemble → retrieve via the
// family-scoped files proxy; cross-family refused; expired → 410; child token → 403.

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
  await prisma.dataExport.deleteMany({ where: { familyId: { in: [fx.familyAId, fx.familyBId] } } });
  await teardownWriteFixture();
});

describe("Data export request + assembly", () => {
  it("request → 202 PENDING; assemble → READY with a downloadRef", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/account/export")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PENDING");
    const exportId = res.body.id as string;

    await assembleDataExport(exportId);

    const status = await request(app)
      .get(`/settings/account/export/${exportId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("READY");
    expect(status.body.downloadRef).toBe(`/files/exports/${exportId}`);
  });

  it("the bundle contains every category and excludes secrets/hashes", async () => {
    const token = await mintOwnerToken(fx);
    const { body } = await request(app)
      .post("/settings/account/export")
      .set("Authorization", `Bearer ${token}`);
    const exportId = body.id as string;
    await assembleDataExport(exportId);

    const row = await prisma.dataExport.findUnique({ where: { id: exportId } });
    const bytes = await storage.get(exportKey(fx.familyAId, exportId));
    const bundle = JSON.parse(gunzipSync(bytes).toString("utf-8"));

    expect(row?.storageKey).toBe(exportKey(fx.familyAId, exportId));
    for (const key of [
      "meta",
      "account",
      "children",
      "progress",
      "sessions",
      "homework",
      "rewards",
      "reminders",
      "billing",
      "consent",
    ]) {
      expect(bundle).toHaveProperty(key);
    }
    // Family-scoped: only this family's child appears (FR-004).
    expect(bundle.children).toHaveLength(1);
    expect(bundle.children[0].id).toBe(fx.childId);
    // Secrets/hashes excluded (data-model §C).
    expect(bundle.children[0]).not.toHaveProperty("passwordHash");
    expect(bundle.children[0]).not.toHaveProperty("pinHash");
    expect(bundle.account.parents[0]).not.toHaveProperty("passwordHash");
  });

  it("retrieval through the files proxy streams the bundle", async () => {
    const token = await mintOwnerToken(fx);
    const { body } = await request(app)
      .post("/settings/account/export")
      .set("Authorization", `Bearer ${token}`);
    const exportId = body.id as string;
    await assembleDataExport(exportId);

    const dl = await request(app)
      .get(`/files/exports/${exportId}`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    const bundle = JSON.parse(gunzipSync(dl.body as Buffer).toString("utf-8"));
    expect(bundle.meta.familyId).toBe(fx.familyAId);
  });
});

describe("Data export isolation + lifecycle", () => {
  it("another family's token cannot retrieve the export (404)", async () => {
    const token = await mintOwnerToken(fx);
    const { body } = await request(app)
      .post("/settings/account/export")
      .set("Authorization", `Bearer ${token}`);
    const exportId = body.id as string;
    await assembleDataExport(exportId);

    const otherToken = await mintFamilyBOwnerToken(fx);
    const status = await request(app)
      .get(`/settings/account/export/${exportId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(status.status).toBe(404);

    const dl = await request(app)
      .get(`/files/exports/${exportId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(dl.status).toBe(404);
  });

  it("an expired export is a 410", async () => {
    const token = await mintOwnerToken(fx);
    const { body } = await request(app)
      .post("/settings/account/export")
      .set("Authorization", `Bearer ${token}`);
    const exportId = body.id as string;
    await assembleDataExport(exportId);

    // Force expiry then run the cleanup sweep.
    await prisma.dataExport.update({
      where: { id: exportId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expireDueExports(new Date());

    const status = await request(app)
      .get(`/settings/account/export/${exportId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(status.status).toBe(410);
  });

  it("rejects a child token with 403 on request and download", async () => {
    const childToken = await mintChildToken(fx);
    expect(
      (
        await request(app)
          .post("/settings/account/export")
          .set("Authorization", `Bearer ${childToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get("/files/exports/anything")
          .set("Authorization", `Bearer ${childToken}`)
      ).status,
    ).toBe(403);
  });
});
