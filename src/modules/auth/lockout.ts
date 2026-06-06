import { getRedis } from "../../db/redis.js";
import { parseTtlToSeconds } from "../../lib/time.js";
import config from "../../config/index.js";

const ttlSeconds = () => parseTtlToSeconds(config.AUTH_LOCK_WINDOW, 900);

function lockKey(accountKey: string): string {
  return `lockout:${accountKey}`;
}

/** Records a failed attempt. Returns the new failure count, or 0 if Redis is unavailable. */
export async function recordFailure(accountKey: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    const k = lockKey(accountKey);
    const count = await r.incr(k);
    if (count === 1) await r.expire(k, ttlSeconds());
    return count;
  } catch {
    return 0;
  }
}

/** Returns true if the account is locked. Returns false if Redis is unavailable (fail-open). */
export async function isLocked(accountKey: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const raw = await r.get(lockKey(accountKey));
    if (!raw) return false;
    return parseInt(raw, 10) >= config.AUTH_LOCK_MAX_ATTEMPTS;
  } catch {
    return false; // fail-open: Redis down means lockout not enforced
  }
}

/** Clears the lockout counter. No-op if Redis is unavailable. */
export async function clear(accountKey: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(lockKey(accountKey));
  } catch {
    // ignore
  }
}
