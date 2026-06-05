import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";

let app: Application;

beforeAll(() => {
  app = createApp();
});

describe("GET /health", () => {
  it("returns 200 with HealthStatus schema when DB is up", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      checks: {
        database: "up",
      },
    });
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it("includes a redis check field", async () => {
    const res = await request(app).get("/health");
    expect(["up", "down", "unknown"]).toContain(res.body.checks.redis);
  });
});
