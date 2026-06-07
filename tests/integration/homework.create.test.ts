import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintCoParentToken,
  mintChildToken,
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
  await teardownWriteFixture();
});

function hwBody(overrides: Record<string, unknown> = {}) {
  return { subject: "Mathematics", topic: "Fractions practice", deadline: "2999-01-01", ...overrides };
}

describe("POST /children/:childId/homework — create (FR-014)", () => {
  it("creates a PENDING homework item for an in-family child", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody());

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.subject).toBe("Mathematics");
    expect(res.body.status).toBe("pending");

    const row = await prisma.homework.findUnique({ where: { id: res.body.id } });
    expect(row).not.toBeNull();
    expect(row!.familyId).toBe(fx.familyAId);
    expect(row!.childId).toBe(fx.childId);
    expect(row!.status).toBe("PENDING");
  });

  it("ignores a client-supplied status — server stays authoritative (FR-017)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody({ status: "COMPLETED" }));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    const row = await prisma.homework.findUnique({ where: { id: res.body.id } });
    expect(row!.status).toBe("PENDING");
  });

  it("marks a past-deadline item OVERDUE on creation", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody({ deadline: "2000-01-01" }));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("overdue");
  });

  it("allows a co-parent to create homework", async () => {
    const token = await mintCoParentToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody());
    expect(res.status).toBe(201);
  });

  it("rejects missing required fields with 400", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send({ subject: "Mathematics" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a child in another family (no cross-family writes)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post(`/children/${fx.familyBChildId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody());
    expect(res.status).toBe(404);
  });

  it("rejects a child token (parents only)", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .post(`/children/${fx.childId}/homework`)
      .set("Authorization", `Bearer ${token}`)
      .send(hwBody());
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`/children/${fx.childId}/homework`).send(hwBody());
    expect(res.status).toBe(401);
  });
});
