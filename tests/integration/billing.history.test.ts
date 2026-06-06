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
  mintCoParentToken,
  mintFamilyBOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US4 (T039): /billing/history + /billing/invoice/:id return the caller's family
// invoices and are individually retrievable; a foreign invoice id → 404.
// (SC-006, FR-018/019/024)

let app: Application;
let fx: WriteFixture;
let invoiceId: string;
let foreignInvoiceId: string;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY");
  await prisma.subscription.update({
    where: { id: fx.subscriptionId },
    data: { status: "ACTIVE" },
  });
  const inv = await prisma.invoice.create({
    data: {
      subscriptionId: fx.subscriptionId,
      issuedAt: new Date(),
      amountMinor: 14900,
      currency: "SAR",
      status: "PAID",
    },
  });
  invoiceId = inv.id;
  const foreign = await prisma.invoice.create({
    data: {
      subscriptionId: fx.familyBSubscriptionId,
      issuedAt: new Date(),
      amountMinor: 9900,
      currency: "SAR",
      status: "PAID",
    },
  });
  foreignInvoiceId = foreign.id;
});

afterEach(async () => {
  await teardownWriteFixture();
});

describe("GET /billing/history + /billing/invoice/:id — US4", () => {
  it("history returns the caller's subscription + invoices", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe("ACTIVE");
    expect(res.body.invoices.length).toBeGreaterThanOrEqual(1);
    expect(res.body.invoices.some((i: { id: string }) => i.id === invoiceId)).toBe(true);
  });

  it("a co-parent can read history (dashboard.view)", async () => {
    const token = await mintCoParentToken(fx);
    const res = await request(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("a single invoice is retrievable when it belongs to the family", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/billing/invoice/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invoiceId);
    expect(res.body.amountMinor).toBe(14900);
  });

  it("a foreign invoice id → 404 (cross-family probe)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/billing/invoice/${foreignInvoiceId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("family B cannot read family A's invoice (404)", async () => {
    const token = await mintFamilyBOwnerToken(fx);
    const res = await request(app)
      .get(`/billing/invoice/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
