import { execSync } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";

export function setup(): void {
  // Resolve the LOCAL prisma binary and pin the cwd to the backend root so neither a
  // stray ambient `npx`/`prisma` on PATH nor an unexpected cwd can run the wrong tool
  // (which previously surfaced as flaky SASL/"module not found" failures across the run).
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const prismaBin = path.join(backendRoot, "node_modules", ".bin", "prisma");
  execSync(`"${prismaBin}" migrate deploy`, {
    cwd: backendRoot,
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
