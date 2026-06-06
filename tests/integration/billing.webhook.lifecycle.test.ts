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
  signFakeEvent,
  type WriteFixture,
} from "./write-fixtures.js";
import type { PaymentPurpose } from "../../src/generated/prisma/client.js";

// US2 (T024): renewal_succeeded extends currentPeriodEnd + new invoice; payment_failed/
// disputed on ACTIVE → PAST_DUE; later recovery → ACTIVE; refunded → access removed +
// invoice VOID. (SC-004/010, FR-009)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY");
  // Start from an ACTIVE subscription for lifecycle tests.
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

async function makeIntent(purpose: PaymentPurpose, amountMinor = 14900): Promise<string> {
  const intent = await prisma.paymentIntent.create({
    data: {
      familyId: fx.familyAId,
      subscriptionId: fx.subscriptionId,
      purpose,
      expectedAmountMinor: amountMinor,
      currency: "SAR",
      providerRef: "",
      status: "CREATED",
    },
  });
  // The fake derives the providerRef from the intent id, so leave providerRef empty —
  // signFakeEvent computes the expected ref from the intentId.
  return intent.id;
}

async function seedPaidInvoice(): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      subscriptionId: fx.subscriptionId,
      issuedAt: new Date(),
      amountMinor: 14900,
      currency: "SAR",
      status: "PAID",
    },
  });
  return inv.id;
}

describe("POST /webhooks/payments — lifecycle (US2)", () => {
  it("renewal_succeeded extends currentPeriodEnd and adds a PAID invoice", async () => {
    const before = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    const intentId = await makeIntent("RENEWAL");
    const { rawBody, signature } = signFakeEvent("renewal_succeeded", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "RENEWAL" },
    });

    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);

    const after = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(after!.status).toBe("ACTIVE");
    expect(after!.currentPeriodEnd.getTime()).toBeGreaterThan(before!.currentPeriodEnd.getTime());

    const paid = await prisma.invoice.count({
      where: { subscriptionId: fx.subscriptionId, status: "PAID" },
    });
    expect(paid).toBe(1);
  });

  it("payment_failed on ACTIVE → PAST_DUE, then recovery → ACTIVE", async () => {
    const failIntentId = await makeIntent("ACTIVATION");
    const fail = signFakeEvent("payment_failed", failIntentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });
    await postWebhook(fail.rawBody, fail.signature);

    let sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PAST_DUE");

    // Recovery via a succeeded ACTIVATION intent.
    const recoverIntentId = await makeIntent("ACTIVATION");
    const recover = signFakeEvent("payment_succeeded", recoverIntentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });
    await postWebhook(recover.rawBody, recover.signature);

    sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("ACTIVE");
  });

  it("disputed on ACTIVE → PAST_DUE", async () => {
    const intentId = await makeIntent("ACTIVATION");
    const { rawBody, signature } = signFakeEvent("disputed", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });
    await postWebhook(rawBody, signature);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PAST_DUE");
  });

  it("refunded removes access and VOIDs the last paid invoice", async () => {
    const invoiceId = await seedPaidInvoice();
    const intentId = await makeIntent("ACTIVATION");
    const { rawBody, signature } = signFakeEvent("refunded", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });
    await postWebhook(rawBody, signature);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PAST_DUE");

    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(inv!.status).toBe("VOID");
  });
});
