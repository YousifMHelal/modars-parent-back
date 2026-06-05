import type { Request, Response } from "express";
import { ErrorCode } from "../lib/errors.js";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: ErrorCode.NOT_FOUND,
      message: "Resource not found.",
    },
  });
}
