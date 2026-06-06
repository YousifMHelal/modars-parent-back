import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  pendingFamilyWithPlanAndChild,
  teardownWriteFixture,
  mintOwnerToken,
  signFakeEvent,
  type WriteFixture,
} from "./write-fixtures.js";

// US3 (T030): /billing/plan-change computes the prorated DIFFERENCE server-side; a
// client-supplied amount is ignored; the upgrade applies on the verified webhook.
// (SC-005, FR-015/016)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  // Start on STARTER (monthly 9900), upgrade to FAMILY (monthly 14900) → diff 5000.
  fx = await pendingFamilyWithPlanAndChild("STARTER");
  await prisma.subscription.update({
    where: { id: fx.subscriptionId },
    data: { status: "ACTIVE" },
  });
});

afterEach(async () => {
  await teardownWriteFixture();
});

function postWebhook(rawBody: Buffer, signature: string) {
  return request(app)
    .post("/webhooks/payments")
    .set("X-Provider-Signature", signature)
    .set("Content-Type", "application/json")
    .send(rawBody.toString("utf-8"));
}

describe("POST /billing/plan-change — US3", () => {
  it("computes the prorated price difference server-side (client amount ignored)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/plan-change")
      .set("Authorization", `Bearer ${token}`)
      .send({ targetPlan: "family", amountMinor: 1, proratedAmountMinor: 1 });

    expect(res.status).toBe(200);
    // diff = 14900 - 9900 = 5000; prorated = round(5000 * remainingDays / 30).
    const expected = Math.round((5000 * res.body.remainingDays) / 30);
    expect(res.body.proratedAmountMinor).toBe(expected);
    expect(res.body.proratedAmountMinor).not.toBe(1);

    const intent = await prisma.paymentIntent.findUnique({ where: { id: res.body.intentId } });
    expect(intent!.purpose).toBe("UPGRADE");
  });

  it("applies the plan swap only on the verified webhook", async () => {
    const token = await mintOwnerToken(fx);
    const quote = await request(app)
      .post("/billing/plan-change")
      .set("Authorization", `Bearer ${token}`)
      .send({ targetPlan: "family" });
    const intentId = quote.body.intentId as string;

    // Before the webhook: still on STARTER.
    const family = await prisma.plan.findUnique({ where: { key: "FAMILY" } });
    let sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.planId).not.toBe(family!.id);

    const { rawBody, signature } = signFakeEvent("payment_succeeded", intentId, {
      amountMinor: quote.body.proratedAmountMinor,
      metadata: { subscriptionId: fx.subscriptionId, purpose: "UPGRADE" },
    });
    await postWebhook(rawBody, signature);

    sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.planId).toBe(family!.id);
  });

  it("a downgrade yields a clean 422 (applies next cycle, no immediate charge)", async () => {
    // Move onto FAMILY first so a change to STARTER is a downgrade.
    const family = await prisma.plan.findUnique({ where: { key: "FAMILY" } });
    await prisma.subscription.update({
      where: { id: fx.subscriptionId },
      data: { planId: family!.id },
    });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/plan-change")
      .set("Authorization", `Bearer ${token}`)
      .send({ targetPlan: "starter" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PRORATION_UNCOMPUTABLE");
  });
});
