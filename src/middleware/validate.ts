import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z, type ZodSchema } from "zod";

interface ValidateSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

type ParsedData = {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const combined = z.object({
      ...(schemas.body ? { body: schemas.body } : {}),
      ...(schemas.params ? { params: schemas.params } : {}),
      ...(schemas.query ? { query: schemas.query } : {}),
    });

    const result = combined.safeParse({
      body: req.body as unknown,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      next(result.error);
      return;
    }

    const data = result.data as ParsedData;

    if (data.body !== undefined) req.body = data.body;
    if (data.params !== undefined) req.params = data.params as Record<string, string>;
    // Express 5: req.query is a read-only getter — skip reassignment (validated values are still in req.query)

    next();
  };
}
