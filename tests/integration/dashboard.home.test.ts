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

describe("GET /dashboard/home", () => {
  it("returns family headline stats with mock parity", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app).get("/dashboard/home").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.minutesThisWeek).toBe(420);
    expect(res.body.stats.mostActive).toEqual({ name: "Ahmed", streakDays: 12 });
    expect(res.body.stats.homeworkDueSoon).toBe(3);
    expect(res.body.stats.unreadNotifications).toBe(5);
  });

  it("returns a ChildOverview per child with the expected fields", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app).get("/dashboard/home").set("Authorization", `Bearer ${token}`);

    expect(res.body.children).toHaveLength(2);
    const ahmed = res.body.children.find((c: { name: string }) => c.name === "Ahmed");
    expect(ahmed).toMatchObject({
      id: fx.ahmedId,
      name: "Ahmed",
      grade: "Grade 8",
      minutesThisWeek: 240,
      sessions: 8,
      streak: 12,
      topSubject: "Mathematics",
      hasStruggleAlert: true,
      status: "active",
    });
    expect(ahmed.lastSession).toEqual({ subject: "Mathematics", when: expect.any(String) });
    expect(ahmed.homework).toEqual({ pending: 2, completed: 2, overdue: 1 });

    const layla = res.body.children.find((c: { name: string }) => c.name === "Layla");
    expect(layla.hasStruggleAlert).toBe(true); // Layla has struggling topics in the seed
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app).get("/dashboard/home").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("rejects a missing token with 401", async () => {
    const res = await request(app).get("/dashboard/home");
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token with 401", async () => {
    const res = await request(app)
      .get("/dashboard/home")
      .set("Authorization", "Bearer not.a.real.token");
    expect(res.status).toBe(401);
  });

  it("returns 200 with zeroed stats and empty children for a childless family", async () => {
    // Remove family A's children + their data, keep the owner.
    await prisma.topicProgress.deleteMany({
      where: { subjectProgress: { familyId: fx.familyAId } },
    });
    await prisma.subjectProgress.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.session.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.homework.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.badge.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.reminderConfig.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.notification.deleteMany({ where: { familyId: fx.familyAId } });
    await prisma.authSession.deleteMany({
      where: { familyId: fx.familyAId, childId: { not: null } },
    });
    await prisma.child.deleteMany({ where: { familyId: fx.familyAId } });

    const token = await mintParentToken(fx);
    const res = await request(app).get("/dashboard/home").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({
      minutesThisWeek: 0,
      mostActive: { name: null, streakDays: 0 },
      homeworkDueSoon: 0,
      unreadNotifications: 0,
    });
    expect(res.body.children).toEqual([]);
  });
});
