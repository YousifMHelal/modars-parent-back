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
  type WriteFixture,
} from "./write-fixtures.js";

// US1 (T012): POST /billing/initiate creates a PaymentIntent(ACTIVATION) + provider
// charge with a SERVER-computed amount, returns a redirectUrl, and leaves the
// subscription PENDING (no activation). An already-ACTIVE subscription → 409.
// (SC-001, FR-001/002)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY"); // FAMILY: monthly 14900
});

afterEach(async () => {
  await teardownWriteFixture();
});

describe("POST /billing/initiate — US1", () => {
  it("creates an ACTIVATION intent + charge, returns redirectUrl, activates nothing", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/initiate")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.intentId).toBeDefined();
    expect(res.body.providerRef).toBeTruthy();
    expect(res.body.redirectUrl).toBeTruthy();
    // FAMILY monthly = 14900 minor units, server-computed (not client-supplied).
    expect(res.body.expectedAmountMinor).toBe(14900);
    expect(res.body.currency).toBe("SAR");

    // The intent exists and is CREATED; the subscription is still PENDING.
    const intent = await prisma.paymentIntent.findUnique({ where: { id: res.body.intentId } });
    expect(intent).not.toBeNull();
    expect(intent!.purpose).toBe("ACTIVATION");
    expect(intent!.expectedAmountMinor).toBe(14900);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PENDING");
  });

  it("ignores any client-supplied amount (no amount is ever accepted)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/initiate")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 1, expectedAmountMinor: 1, amountMinor: 1 });

    expect(res.status).toBe(200);
    expect(res.body.expectedAmountMinor).toBe(14900);
  });

  it("rejects initiate on an already-ACTIVE subscription with 409", async () => {
    await prisma.subscription.update({
      where: { id: fx.subscriptionId },
      data: { status: "ACTIVE" },
    });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/initiate")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SUBSCRIPTION_ALREADY_ACTIVE");
  });
});
