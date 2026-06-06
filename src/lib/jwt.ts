import jwt, { type SignOptions } from "jsonwebtoken";
import config from "../config/index.js";

export type PrincipalRole = "owner" | "co_parent" | "child";
export type PrincipalType = "parent" | "child";

export interface AccessTokenClaims {
  sub: string;
  type: PrincipalType;
  role: PrincipalRole;
  familyId: string;
  sid: string;
}

export interface RefreshTokenClaims {
  sub: string;
  sid: string;
  type: PrincipalType;
  jti: string; // random nonce whose sha256 is stored in AuthSession.refreshTokenHash
}

export interface DobPendingClaims {
  sub: string; // parentId of the freshly created OAuth account awaiting a DOB
  purpose: "dob_pending";
}

// `expiresIn` is a runtime-validated duration string ("15m", "30d"); @types/jsonwebtoken
// narrows it to a branded StringValue, so cast through the option's own type.
type ExpiresIn = NonNullable<SignOptions["expiresIn"]>;

export function signAccess(claims: AccessTokenClaims): string {
  return jwt.sign({ ...claims }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL as ExpiresIn,
    algorithm: "HS256",
  } satisfies SignOptions);
}

export function signRefresh(claims: RefreshTokenClaims): string {
  return jwt.sign({ ...claims }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_TTL as ExpiresIn,
    algorithm: "HS256",
  } satisfies SignOptions);
}

export function verifyAccess(token: string): AccessTokenClaims {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as AccessTokenClaims;
}

export function verifyRefresh(token: string): RefreshTokenClaims {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, {
    algorithms: ["HS256"],
  }) as RefreshTokenClaims;
}

/** Short-lived token proving the bearer just completed OAuth and may set a DOB
 *  for exactly this parent account — prevents setting a DOB on an arbitrary id. */
export function signDobPending(parentId: string): string {
  return jwt.sign({ purpose: "dob_pending" }, config.JWT_ACCESS_SECRET, {
    subject: parentId,
    expiresIn: "15m",
    algorithm: "HS256",
  } satisfies SignOptions);
}

export function verifyDobPending(token: string): DobPendingClaims {
  const claims = jwt.verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as DobPendingClaims;
  if (claims.purpose !== "dob_pending") {
    throw new Error("Invalid token purpose");
  }
  return claims;
}
