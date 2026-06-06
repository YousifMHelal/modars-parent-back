import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  setupDashboardFixture,
  teardownDashboardFixture,
  mintParentToken,
  mintChildToken,
  type DashboardFixture,
} from "./dashboard-fixtures.js";

let app: Application;
let fx: DashboardFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  await teardownDashboardFixture();
  fx = await setupDashboardFixture();
});

afterEach(async () => {
  await teardownDashboardFixture();
});

describe("GET /dashboard/children", () => {
  it("lists the caller's children with list + overview fields", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/children")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.children).toHaveLength(2);

    const ahmed = res.body.children.find((c: { name: string }) => c.name === "Ahmed");
    expect(ahmed).toMatchObject({
      id: fx.ahmedId,
      displayName: "Ahmed",
      age: expect.any(Number),
      username: "ahmed.modrs.dashtest",
      grade: "Grade 8",
      minutesThisWeek: 240,
      status: "active",
    });
    expect(ahmed.homework).toEqual({ pending: 2, completed: 2, overdue: 1 });
  });

  it("never returns another family's children", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/children")
      .set("Authorization", `Bearer ${token}`);

    const ids = res.body.children.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(fx.familyBChildId);
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .get("/dashboard/children")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns { children: [] } for an empty family", async () => {
    await prisma.authSession.deleteMany({
      where: { familyId: fx.familyAId, childId: { not: null } },
    });
    await prisma.topicProgress.deleteMany({
      where: { subjectProgress: { familyId: fx.familyAId } },
    });
    await prisma.subjectProgress.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.session.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.homework.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.badge.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.reminderConfig.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.child.deleteMany({ where: { familyId: fx.familyAId } });

    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/children")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.children).toEqual([]);
  });
});
