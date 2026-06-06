import { execSync } from "child_process";
import Redis from "ioredis";

export function setup(): void {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env },
    stdio: "inherit",
  });
}

export async function teardown(): Promise<void> {
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl, { lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch {
    // Redis may not be running in all CI environments; non-fatal
  } finally {
    await redis.quit();
  }
}
