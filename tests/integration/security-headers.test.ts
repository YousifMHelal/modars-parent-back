import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";

let app: Application;

beforeAll(() => {
  app = createApp();
});

describe("Security headers (helmet)", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("sets X-DNS-Prefetch-Control", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
  });
});
