import { describe, it, expect } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import errorHandler from "../../src/middleware/errorHandler.js";
import { notFound } from "../../src/middleware/notFound.js";
import { AppError, ErrorCode } from "../../src/lib/errors.js";

function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/test/error/app", (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(400, ErrorCode.VALIDATION_ERROR, "Test validation error"));
  });

  app.get("/test/error/internal", (_req: Request, _res: Response, next: NextFunction) => {
    next(new Error("Unexpected internal error"));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = buildTestApp();

describe("Centralized error handler", () => {
  it("returns standard error envelope for AppError", async () => {
    const res = await request(app).get("/test/error/app");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Test validation error",
      },
    });
    expect(res.body.error.stack).toBeUndefined();
  });

  it("returns 500 generic envelope for unknown errors without leaking internals", async () => {
    const res = await request(app).get("/test/error/internal");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
      },
    });
    expect(res.body.error.message).not.toContain("Unexpected internal error");
    expect(res.body.error.stack).toBeUndefined();
  });

  it("returns 404 NOT_FOUND for unknown routes", async () => {
    const res = await request(app).get("/no-such-route");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});
