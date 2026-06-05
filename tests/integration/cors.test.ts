import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";

let app: Application;

beforeAll(() => {
  app = createApp();
});

describe("CORS", () => {
  it("permits a request from an allowed origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("rejects a request from a disallowed origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).not.toBe(
      "http://evil.example.com",
    );
  });
});
