import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../../src/middleware/validate.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as Request;
}

function mockRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("validate() middleware", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("calls next() when body matches schema", () => {
    const req = mockReq({ body: { name: "test" } });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    validate({ body: schema })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("replaces req.body with typed parsed value", () => {
    const req = mockReq({ body: { name: "test", extra: "dropped" } });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    validate({ body: schema })(req, res, next);

    expect(req.body).toEqual({ name: "test" });
  });

  it("calls next(error) when body fails schema", () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    validate({ body: schema })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const calledWith = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(calledWith).toBeDefined();
    expect((calledWith as Error).message).toBeTruthy();
  });

  it("does not execute handler body on validation failure", () => {
    const handlerCalled = { value: false };
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = vi.fn((_err?: unknown) => {
      if (!_err) handlerCalled.value = true;
    }) as NextFunction;

    validate({ body: schema })(req, res, next);

    expect(handlerCalled.value).toBe(false);
  });
});
