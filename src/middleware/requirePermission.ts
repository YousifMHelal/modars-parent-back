import type { Request, Response, NextFunction } from "express";
import { can, type Action } from "../modules/auth/permissions.js";
import { getRedis } from "../db/redis.js";
import { parseTtlToSeconds } from "../lib/time.js";
import config from "../config/index.js";

type RoleType = "parent" | "child";

const reauthWindowSeconds = () => parseTtlToSeconds(config.REAUTH_WINDOW, 900);

/** Reject requests from principals whose token type doesn't match. */
export function requireRole(roleType: RoleType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
      return;
    }
    if (principal.type !== roleType) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Insufficient role" } });
      return;
    }
    next();
  };
}

/** Reject requests when the principal's role lacks the required action. */
export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
      return;
    }
    if (!can(principal.role, action)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Action not permitted" } });
      return;
    }
    next();
  };
}

/** Shared-device dashboard gate: requires a Redis re-auth marker for the device. */
export function requireReauth(getDeviceId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const principal = req.principal;
    if (!principal || principal.type !== "parent") {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
      return;
    }

    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "deviceId required" } });
      return;
    }

    const r = getRedis();
    if (!r) {
      // Can't verify the marker without Redis — honor the configured posture.
      if (config.REAUTH_FAIL_OPEN) {
        next();
        return;
      }
      res
        .status(503)
        .json({ error: { code: "REAUTH_REQUIRED", message: "Re-authentication required" } });
      return;
    }

    try {
      const marker = await r.get(`reauth:${principal.id}:${deviceId}`);
      if (!marker) {
        res
          .status(401)
          .json({ error: { code: "REAUTH_REQUIRED", message: "Re-authentication required" } });
        return;
      }
      // Sliding window: reset TTL on each use
      await r.expire(`reauth:${principal.id}:${deviceId}`, reauthWindowSeconds());
    } catch {
      // Redis errored — honor the configured posture rather than silently allowing.
      if (config.REAUTH_FAIL_OPEN) {
        next();
        return;
      }
      res
        .status(503)
        .json({ error: { code: "REAUTH_REQUIRED", message: "Re-authentication required" } });
      return;
    }

    next();
  };
}
