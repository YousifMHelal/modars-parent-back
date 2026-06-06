import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import { PLANS_DATA } from "../../prisma/seed/mock-data.js";

let app: Application;

const TEST_EMAILS = new Set<string>();

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

async function ensurePlans() {
  for (const p of PLANS_DATA) {
    await prisma.plan.upsert({ where: { key: p.key }, update: {}, create: p });
  }
}

async function cleanup() {
  const parents = await prisma.parent.findMany({
    where: { email: { in: [...TEST_EMAILS] } },
    select: { familyId: true },
  });
  const familyIds = [...new Set(parents.map((p) => p.familyId))];
  if (familyIds.length === 0) return;
  await prisma.coParentInvitation.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.subscription.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.authSession.updateMany({
    where: { familyId: { in: familyIds } },
    data: { replacedById: null },
  });
  await prisma.authSession.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.child.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.emailVerificationToken.deleteMany({
    where: { parent: { familyId: { in: familyIds } } },
  });
  await prisma.parent.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.family.deleteMany({ where: { id: { in: familyIds } } });
}

beforeEach(async () => {
  await ensurePlans();
});
afterEach(async () => {
  await cleanup();
  TEST_EMAILS.clear();
});

function regBody(email: string) {
  TEST_EMAILS.add(email);
  return {
    fullName: "New Parent",
    email,
    password: "secret123",
    dateOfBirth: "1990-01-01",
    country: "SA",
  };
}

describe("Onboarding persistence (US1)", () => {
  it("register → plan (PENDING) → first child before payment; subscription stays PENDING", async () => {
    const email = `onb.${Math.random().toString(36).slice(2)}@test.write`;
    const reg = await request(app).post("/onboarding/register").send(regBody(email));
    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toBeDefined();
    const token = reg.body.accessToken as string;

    // Family + owner parent persisted.
    const parent = await prisma.parent.findUnique({ where: { email } });
    expect(parent).not.toBeNull();
    expect(parent!.role).toBe("OWNER");
    const familyId = parent!.familyId;

    // Plan selection creates a PENDING subscription.
    const plan = await request(app)
      .put("/onboarding/plan")
      .set("Authorization", `Bearer ${token}`)
      .send({ plan: "family", billingCycle: "YEARLY" });
    expect(plan.status).toBe(200);

    const sub = await prisma.subscription.findFirst({ where: { familyId } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("PENDING");
    expect(sub!.billingCycle).toBe("YEARLY");

    // First child created before any payment.
    const childRes = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "First Kid",
        dateOfBirth: "2015-03-03",
        gender: "MALE",
        country: "SA",
        grade: "Grade 3",
        curriculum: "BRITISH",
        subjects: ["Mathematics"],
        username: `firstkid_${Math.random().toString(36).slice(2, 7)}`,
        password: "kidpass1",
      });
    expect(childRes.status).toBe(201);

    const childCount = await prisma.child.count({ where: { familyId, deletedAt: null } });
    expect(childCount).toBe(1);

    // Subscription is STILL PENDING after the child create.
    const subAfter = await prisma.subscription.findFirst({ where: { familyId } });
    expect(subAfter!.status).toBe("PENDING");
  });

  it("resume state derives the next incomplete step from existing rows", async () => {
    const email = `onb.${Math.random().toString(36).slice(2)}@test.write`;
    const reg = await request(app).post("/onboarding/register").send(regBody(email));
    const token = reg.body.accessToken as string;

    // Parent only → step 2.
    let state = await request(app)
      .get("/onboarding/state")
      .set("Authorization", `Bearer ${token}`);
    expect(state.status).toBe(200);
    expect(state.body.nextStep).toBe(2);
    expect(state.body.planChosen).toBe(false);

    // After plan → step 3.
    await request(app)
      .put("/onboarding/plan")
      .set("Authorization", `Bearer ${token}`)
      .send({ plan: "starter", billingCycle: "MONTHLY" });
    state = await request(app).get("/onboarding/state").set("Authorization", `Bearer ${token}`);
    expect(state.body.nextStep).toBe(3);
    expect(state.body.subscriptionStatus).toBe("PENDING");
  });

  it("rejects a child token on plan/state writes (403)", async () => {
    // Build a parent, then mint a child token in the same family.
    const email = `onb.${Math.random().toString(36).slice(2)}@test.write`;
    const reg = await request(app).post("/onboarding/register").send(regBody(email));
    const parentToken = reg.body.accessToken as string;
    const parent = await prisma.parent.findUnique({ where: { email } });
    const familyId = parent!.familyId;

    const child = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${parentToken}`)
      .send({
        displayName: "Kid",
        dateOfBirth: "2015-03-03",
        gender: "FEMALE",
        country: "SA",
        grade: "Grade 3",
        curriculum: "BRITISH",
        subjects: ["Science"],
        username: `kid_${Math.random().toString(36).slice(2, 7)}`,
        pin: "1234",
      });
    const childId = child.body.id as string;

    const { signAccess } = await import("../../src/lib/jwt.js");
    const session = await prisma.authSession.create({
      data: {
        familyId,
        principalType: "CHILD",
        childId,
        refreshTokenHash: `c-${Math.random()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const childToken = signAccess({
      sub: childId,
      type: "child",
      role: "child",
      familyId,
      sid: session.id,
    });

    const planRes = await request(app)
      .put("/onboarding/plan")
      .set("Authorization", `Bearer ${childToken}`)
      .send({ plan: "family", billingCycle: "MONTHLY" });
    expect(planRes.status).toBe(403);

    const stateRes = await request(app)
      .get("/onboarding/state")
      .set("Authorization", `Bearer ${childToken}`);
    expect(stateRes.status).toBe(403);
  });
});
