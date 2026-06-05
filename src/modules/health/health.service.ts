import prisma from "../../db/prisma.js";
import { getStatus } from "../../db/redis.js";

export interface HealthStatus {
  status: "ok" | "degraded";
  uptime: number;
  timestamp: string;
  checks: {
    database: "up" | "down";
    redis: "up" | "down" | "unknown";
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  let databaseStatus: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = "up";
  } catch {
    databaseStatus = "down";
  }

  const redisStatusRaw = getStatus();
  const redisStatus: "up" | "down" | "unknown" =
    redisStatusRaw === "ready" ? "up" : redisStatusRaw === "down" ? "down" : "unknown";

  const status = databaseStatus === "down" ? "degraded" : "ok";

  return {
    status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database: databaseStatus,
      redis: redisStatus,
    },
  };
}
