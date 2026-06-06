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

describe("GET /dashboard/children/:childId", () => {
  it("returns the full nested profile shape with parity", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get(`/dashboard/children/${fx.ahmedId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Overview block
    expect(body).toMatchObject({
      id: fx.ahmedId,
      name: "Ahmed",
      displayName: "Ahmed",
      grade: "Grade 8",
      status: "active",
      dob: "15 Mar 2011",
      gender: "Male",
      country: "Saudi Arabia",
      curriculum: "British",
      username: "ahmed.modrs.dashtest",
      minutesThisWeek: 240,
      sessionsThisWeek: 8,
      streak: 12,
      totalXP: 8450,
      totalMinutes: 3240,
      masteryPercentage: 68,
      coveragePercentage: 75,
      trendVsLastWeek: 15,
      level: 12,
      levelXp: 650,
      levelMax: 1000,
      nextLevel: 13,
      streakTokens: 3,
      bedtimeCutoff: "21:00",
    });
    expect(body.subjects).toEqual(["Mathematics", "Science", "English", "Arabic"]);
    expect(body.allowedDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);

    // subjectProgress
    expect(body.subjectProgress).toHaveLength(4);
    const math = body.subjectProgress.find((s: { subject: string }) => s.subject === "Mathematics");
    expect(math).toMatchObject({ mastery: 68, coverage: 82, trend: "up" });
    expect(math.masteryHistory).toEqual([52, 58, 63, 68]);
    expect(math.topics.length).toBeGreaterThan(0);
    expect(math.topics[0]).toEqual({
      name: expect.any(String),
      mastery: expect.any(Number),
      struggling: expect.any(Boolean),
    });
    expect(math.recentSessions.length).toBeGreaterThan(0);
    expect(math.recentSessions.length).toBeLessThanOrEqual(3);
    expect(math.recentSessions[0]).toMatchObject({
      date: expect.any(String),
      duration: expect.any(String),
    });
    expect(typeof math.lastStudied).toBe("string");

    // homework
    expect(body.homework.length).toBe(5);
    expect(body.homework[0]).toMatchObject({
      id: expect.any(String),
      subject: expect.any(String),
      topic: expect.any(String),
      deadline: expect.any(String),
      status: expect.any(String),
      daysInfo: expect.any(String),
    });

    // sessions (overall, take 5)
    expect(body.sessions.length).toBe(5);
    expect(body.sessions[0]).toMatchObject({
      id: expect.any(String),
      date: expect.any(String),
      subject: expect.any(String),
      duration: expect.any(String),
      topics: expect.any(Array),
    });

    // badges split
    expect(body.badges.length).toBe(8);
    const earned = body.badges.filter((b: { earned: boolean }) => b.earned);
    const inProgress = body.badges.filter((b: { earned: boolean }) => !b.earned);
    expect(earned.length).toBe(4);
    expect(earned[0].date).toEqual(expect.any(String));
    expect(inProgress[0].progress).toMatchObject({
      current: expect.any(Number),
      total: expect.any(Number),
      unit: expect.any(String),
    });
  });

  it("returns 404 for a child id from another family (no cross-family leak)", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get(`/dashboard/children/${fx.familyBChildId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent child id (indistinguishable from cross-family)", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/children/clnonexistentid000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .get(`/dashboard/children/${fx.ahmedId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with empty sections for a child with no data", async () => {
    // Strip Ahmed's nested data, keep the child row.
    await prisma.topicProgress.deleteMany({
      where: { subjectProgress: { childId: fx.ahmedId } },
    });
    await prisma.subjectProgress.deleteMany({ where: { childId: fx.ahmedId } });
    await prisma.session.deleteMany({ where: { childId: fx.ahmedId } });
    await prisma.homework.deleteMany({ where: { childId: fx.ahmedId } });
    await prisma.badge.deleteMany({ where: { childId: fx.ahmedId } });

    const token = await mintParentToken(fx);
    const res = await request(app)
      .get(`/dashboard/children/${fx.ahmedId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subjectProgress).toEqual([]);
    expect(res.body.homework).toEqual([]);
    expect(res.body.sessions).toEqual([]);
    expect(res.body.badges).toEqual([]);
  });
});
