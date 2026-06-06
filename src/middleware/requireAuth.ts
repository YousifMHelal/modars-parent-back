import type { Request, Response, NextFunction } from "express";
import { verifyAccess, type AccessTokenClaims } from "../lib/jwt.js";
import { isSessionValid } from "../modules/auth/auth.service.js";

export interface Principal {
  id: string;
  type: AccessTokenClaims["type"];
  role: AccessTokenClaims["role"];
  familyId: string;
  sid: string;
}

// Augment Express Request with principal field
declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
    return;
  }

  const token = authHeader.slice(7);
  let claims: AccessTokenClaims;
  try {
    claims = verifyAccess(token);
  } catch {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
    return;
  }

  try {
    const valid = await isSessionValid(claims.sid);
    if (!valid) {
      res
        .status(401)
        .json({ error: { code: "UNAUTHORIZED", message: "Session revoked or expired" } });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  req.principal = {
    id: claims.sub,
    type: claims.type,
    role: claims.role,
    familyId: claims.familyId,
    sid: claims.sid,
  };

  next();
}
