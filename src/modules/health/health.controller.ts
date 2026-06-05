import type { Request, Response } from "express";
import { getHealthStatus } from "./health.service.js";

export async function healthController(
  _req: Request,
  res: Response,
): Promise<void> {
  const health = await getHealthStatus();
  const statusCode = health.status === "degraded" ? 503 : 200;
  res.status(statusCode).json(health);
}
