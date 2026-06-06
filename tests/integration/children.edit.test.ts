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

beforeEach(async () => {
  fx = await setupWriteFixture("FAMILY");
});
afterEach(async () => {
  await teardownWriteFixture();
});

describe("PATCH /children/:childId — edit (US2)", () => {
  it("persists profile/control updates", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        grade: "Grade 7",
        curriculum: "IB",
        subjects: ["Physics", "Chemistry"],
        bedtimeCutoff: "21:00",
        allowedDays: ["Mon", "Tue"],
        blockedSubjects: ["History"],
      });
    expect(res.status).toBe(200);

    const child = await prisma.child.findUnique({ where: { id: fx.childId } });
    expect(child!.grade).toBe("Grade 7");
    expect(child!.curriculum).toBe("IB");
    expect(child!.subjects).toEqual(["Physics", "Chemistry"]);
    expect(child!.bedtimeCutoff).toBe("21:00");
    expect(child!.allowedDays).toEqual(["Mon", "Tue"]);
    expect(child!.blockedSubjects).toEqual(["History"]);
  });

  it("editing a soft-deleted child returns 404", async () => {
    await prisma.child.update({ where: { id: fx.childId }, data: { deletedAt: new Date() } });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grade: "Grade 8" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /children/:childId/credentials (US2)", () => {
  it("rotates credentials and revokes the child's active sessions", async () => {
    const token = await mintOwnerToken(fx);
    // The fixture seeded a live child session.
    const before = await prisma.authSession.findUnique({ where: { id: fx.childSessionId } });
    expect(before!.revokedAt).toBeNull();

    const res = await request(app)
      .patch(`/children/${fx.childId}/credentials`)
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "newpass1" });
    expect(res.status).toBe(200);

    const after = await prisma.authSession.findUnique({ where: { id: fx.childSessionId } });
    expect(after!.revokedAt).not.toBeNull();
  });

  it("rejects a username already taken by another child (409)", async () => {
    const token = await mintOwnerToken(fx);
    // Family B child's username is globally unique and taken.
    const other = await prisma.child.findUnique({ where: { id: fx.familyBChildId } });
    const res = await request(app)
      .patch(`/children/${fx.childId}/credentials`)
      .set("Authorization", `Bearer ${token}`)
      .send({ username: other!.username });
    expect(res.status).toBe(409);
  });
});
