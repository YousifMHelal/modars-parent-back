import { describe, it, expect, beforeAll } from "vitest";
import supertestRequest from "supertest";
import expressApp from "express";
import type { Application } from "express";
import rateLimit from "express-rate-limit";
import { ErrorCode } from "../../src/lib/errors.js";
import healthRouter from "../../src/modules/health/health.routes.js";
import { notFound } from "../../src/middleware/notFound.js";
import errorHandler from "../../src/middleware/errorHandler.js";

let app: Application;

beforeAll(() => {
  const strictLimiter = rateLimit({
    windowMs: 60000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: "Too many requests, please try again later.",
        },
      });
    },
  });

  app = expressApp();
  app.use(expressApp.json());
  app.use(strictLimiter);
  app.use(healthRouter);
  app.use(notFound);
  app.use(errorHandler);
});

describe("Rate limiting", () => {
  it("returns 429 after exceeding the limit, with a standard error envelope", async () => {
    for (let i = 0; i < 3; i++) {
      await supertestRequest(app).get("/health");
    }

    const res = await supertestRequest(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: {
        code: "RATE_LIMITED",
      },
    });
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
