import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";

vi.mock("../../src/modules/health/health.service.js", () => ({
  getHealthStatus: vi.fn(),
}));

import { createApp } from "../../src/app.js";
import { getHealthStatus } from "../../src/modules/health/health.service.js";

let app: Application;

beforeAll(() => {
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /health — degraded scenarios", () => {
  it("returns 503 with status degraded when DB liveness check fails", async () => {
    vi.mocked(getHealthStatus).mockResolvedValueOnce({
      status: "degraded",
      uptime: 5,
      timestamp: new Date().toISOString(),
      checks: { database: "down", redis: "unknown" },
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "degraded",
      checks: { database: "down" },
    });
  });

  it("returns 200 even when Redis status is down", async () => {
    vi.mocked(getHealthStatus).mockResolvedValueOnce({
      status: "ok",
      uptime: 5,
      timestamp: new Date().toISOString(),
      checks: { database: "up", redis: "down" },
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.redis).toBe("down");
  });
});
