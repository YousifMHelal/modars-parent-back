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
  type WriteFixture,
} from "./write-fixtures.js";

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

afterEach(async () => {
  await teardownWriteFixture();
});

describe("Child lifecycle (US2)", () => {
  it("pause sets PAUSED and revokes child sessions; reactivate sets ACTIVE", async () => {
    fx = await setupWriteFixture("FAMILY");
    const token = await mintOwnerToken(fx);

    const pause = await request(app)
      .post(`/children/${fx.childId}/pause`)
      .set("Authorization", `Bearer ${token}`);
    expect(pause.status).toBe(200);

    let child = await prisma.child.findUnique({ where: { id: fx.childId } });
    expect(child!.status).toBe("PAUSED");
    const session = await prisma.authSession.findUnique({ where: { id: fx.childSessionId } });
    expect(session!.revokedAt).not.toBeNull();

    const reactivate = await request(app)
      .post(`/children/${fx.childId}/reactivate`)
      .set("Authorization", `Bearer ${token}`);
    expect(reactivate.status).toBe(200);
    child = await prisma.child.findUnique({ where: { id: fx.childId } });
    expect(child!.status).toBe("ACTIVE");
  });

  it("soft-delete drops the child from active reads and reserves the username", async () => {
    fx = await setupWriteFixture("FAMILY");
    const token = await mintOwnerToken(fx);
    const child = await prisma.child.findUnique({ where: { id: fx.childId } });
    const username = child!.username;

    const del = await request(app)
      .delete(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const deleted = await prisma.child.findUnique({ where: { id: fx.childId } });
    expect(deleted!.deletedAt).not.toBeNull();
    // Username still reserved (the row + unique index remain).
    const byUsername = await prisma.child.findUnique({ where: { usernameNormalized: username } });
    expect(byUsername).not.toBeNull();

    // Dropped from active reads.
    const active = await prisma.child.count({ where: { familyId: fx.familyAId, deletedAt: null } });
    expect(active).toBe(0);
  });

  it("restore within 7 days returns the child intact", async () => {
    fx = await setupWriteFixture("FAMILY");
    const token = await mintOwnerToken(fx);
    await prisma.child.update({
      where: { id: fx.childId },
      data: { deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }, // 2 days ago
    });

    const res = await request(app)
      .post(`/children/${fx.childId}/restore`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const child = await prisma.child.findUnique({ where: { id: fx.childId } });
    expect(child!.deletedAt).toBeNull();
  });

  it("restore after 7 days fails with RESTORE_WINDOW_EXPIRED (410)", async () => {
    fx = await setupWriteFixture("FAMILY");
    const token = await mintOwnerToken(fx);
    await prisma.child.update({
      where: { id: fx.childId },
      data: { deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }, // 8 days ago
    });

    const res = await request(app)
      .post(`/children/${fx.childId}/restore`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("RESTORE_WINDOW_EXPIRED");
  });

  it("restore into a full plan fails with PLAN_LIMIT_REACHED (409)", async () => {
    // Starter plan, childLimit 1. Soft-delete the one child, create another to fill the slot,
    // then attempt to restore the deleted one → over limit.
    fx = await setupWriteFixture("STARTER");
    const token = await mintOwnerToken(fx);

    await prisma.child.update({
      where: { id: fx.childId },
      data: { deletedAt: new Date() },
    });
    // Fill the single slot with a fresh active child.
    await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "Replacement",
        dateOfBirth: "2015-01-01",
        gender: "FEMALE",
        country: "SA",
        grade: "Grade 2",
        curriculum: "BRITISH",
        subjects: ["Mathematics"],
        username: `repl_${Math.random().toString(36).slice(2, 7)}`,
        pin: "1234",
      });

    const res = await request(app)
      .post(`/children/${fx.childId}/restore`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_LIMIT_REACHED");
  });
});
