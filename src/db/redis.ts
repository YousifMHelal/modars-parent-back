import { Redis } from "ioredis";
import pino from "pino";

const logger = pino({ name: "redis" });

let _redis: Redis | null = null;
let _status: "connecting" | "ready" | "down" | "unknown" = "unknown";

export function getRedis(): Redis | null {
  return _redis;
}

export function getStatus(): "connecting" | "ready" | "down" | "unknown" {
  return _status;
}

export function createRedisClient(url: string): Redis {
  if (_redis) return _redis;

  _status = "connecting";
  const client = new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
  });

  client.on("ready", () => {
    _status = "ready";
    logger.info("Redis connected");
  });

  client.on("error", (err: Error) => {
    _status = "down";
    logger.warn({ err: err.message }, "Redis error (non-fatal)");
  });

  client.on("close", () => {
    _status = "down";
  });

  _redis = client;

  client.connect().catch((err: Error) => {
    _status = "down";
    logger.warn({ err: err.message }, "Redis initial connect failed (non-fatal)");
  });

  return client;
}

export default { getRedis, getStatus, createRedisClient };
