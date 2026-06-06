import crypto from "crypto";
import prisma from "../../db/prisma.js";
import { getRedis } from "../../db/redis.js";
import { hashSecret, verifySecret, dummyVerify } from "../../lib/hashing.js";
import {
  signAccess,
  signRefresh,
  signDobPending,
  verifyRefresh,
  verifyDobPending,
  type AccessTokenClaims,
  type PrincipalRole,
  type PrincipalType,
} from "../../lib/jwt.js";
import { recordFailure, isLocked, clear as clearLockout } from "./lockout.js";
import { AppError, ErrorCode } from "../../lib/errors.js";
import { sendVerificationEmail } from "../../lib/mailer.js";
import { parseTtlToSeconds } from "../../lib/time.js";
import config from "../../config/index.js";

// ── Error helpers ─────────────────────────────────────────────────────────────

const UNAUTHORIZED = (msg = "Invalid credentials") =>
  new AppError(401, ErrorCode.UNAUTHORIZED, msg);
const LOCKED = () =>
  new AppError(429, ErrorCode.RATE_LIMITED, "Too many failed attempts, try later");
const UNPROCESSABLE = (msg: string) => new AppError(422, ErrorCode.VALIDATION_ERROR, msg);
const CONFLICT = (msg: string) => new AppError(409, ErrorCode.VALIDATION_ERROR, msg);

// ── TTL helpers ───────────────────────────────────────────────────────────────

const refreshTtlSeconds = () => parseTtlToSeconds(config.JWT_REFRESH_TTL, 30 * 86400);
const reauthWindowSeconds = () => parseTtlToSeconds(config.REAUTH_WINDOW, 900);

function makeRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyRefreshToken(token: string, storedHash: string): boolean {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ── Session validation (used by requireAuth middleware) ───────────────────────

export async function isSessionValid(sessionId: string): Promise<boolean> {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt < new Date()) return false;
  return true;
}

/**
 * Phase 8 (FR-014): a family in pending deletion (deletedAt != null) has its access
 * revoked at the deletion *request*. No token may be minted or refreshed during the
 * retain window, so a partially-purged family can never authenticate. Throws 403.
 */
async function assertFamilyNotPendingDeletion(familyId: string): Promise<void> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { deletedAt: true },
  });
  if (family?.deletedAt) {
    throw new AppError(403, ErrorCode.FORBIDDEN, "This account is scheduled for deletion");
  }
}

// ── Session primitives ────────────────────────────────────────────────────────

export async function issueSessionPair(params: {
  principalId: string;
  principalType: PrincipalType;
  role: PrincipalRole;
  familyId: string;
  deviceLabel?: string;
}): Promise<TokenPair & { sessionId: string }> {
  const { principalId, principalType, role, familyId } = params;
  const deviceLabel = params.deviceLabel;
  const plainRefresh = makeRefreshToken();
  const refreshHash = hashRefreshToken(plainRefresh);

  const session = await prisma.authSession.create({
    data: {
      familyId,
      principalType: principalType === "parent" ? "PARENT" : "CHILD",
      ...(principalType === "parent" ? { parentId: principalId } : {}),
      ...(principalType === "child" ? { childId: principalId } : {}),
      refreshTokenHash: refreshHash,
      expiresAt: new Date(Date.now() + refreshTtlSeconds() * 1000),
      ...(deviceLabel !== undefined ? { deviceLabel } : {}),
    },
  });

  const accessClaims: AccessTokenClaims = {
    sub: principalId,
    type: principalType,
    role,
    familyId,
    sid: session.id,
  };

  return {
    accessToken: signAccess(accessClaims),
    refreshToken: signRefresh({
      sub: principalId,
      sid: session.id,
      type: principalType,
      jti: plainRefresh,
    }),
    sessionId: session.id,
  };
}

export async function rotateRefresh(refreshToken: string): Promise<TokenPair> {
  let claims;
  try {
    claims = verifyRefresh(refreshToken);
  } catch {
    throw UNAUTHORIZED("Invalid refresh token");
  }

  const session = await prisma.authSession.findUnique({ where: { id: claims.sid } });
  if (!session || session.revokedAt) throw UNAUTHORIZED("Session revoked");
  if (session.expiresAt < new Date()) throw UNAUTHORIZED("Session expired");

  // FR-014: refuse to refresh a token for a family pending deletion (access revoked).
  await assertFamilyNotPendingDeletion(session.familyId);

  if (session.rotatedAt) {
    await revokeLineage(session.id);
    throw UNAUTHORIZED("Refresh token already used — session revoked");
  }

  const ok = verifyRefreshToken(claims.jti, session.refreshTokenHash);
  if (!ok) throw UNAUTHORIZED("Invalid refresh token");

  const plainRefresh = makeRefreshToken();
  const refreshHash = hashRefreshToken(plainRefresh);

  const newSession = await prisma.authSession.create({
    data: {
      familyId: session.familyId,
      principalType: session.principalType,
      ...(session.parentId !== null ? { parentId: session.parentId } : {}),
      ...(session.childId !== null ? { childId: session.childId } : {}),
      refreshTokenHash: refreshHash,
      expiresAt: new Date(Date.now() + refreshTtlSeconds() * 1000),
      ...(session.deviceLabel !== null ? { deviceLabel: session.deviceLabel } : {}),
    },
  });

  await prisma.authSession.update({
    where: { id: session.id },
    data: { rotatedAt: new Date(), replacedById: newSession.id, lastUsedAt: new Date() },
  });

  const principalId = session.parentId ?? session.childId ?? claims.sub;
  const principalType: PrincipalType = session.principalType === "PARENT" ? "parent" : "child";

  let role: PrincipalRole = "child";
  if (principalType === "parent" && session.parentId) {
    const parent = await prisma.parent.findUnique({ where: { id: session.parentId } });
    role = parent?.role === "OWNER" ? "owner" : "co_parent";
  }

  const accessClaims: AccessTokenClaims = {
    sub: principalId,
    type: principalType,
    role,
    familyId: session.familyId,
    sid: newSession.id,
  };

  return {
    accessToken: signAccess(accessClaims),
    refreshToken: signRefresh({
      sub: principalId,
      sid: newSession.id,
      type: principalType,
      jti: plainRefresh,
    }),
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForChild(childId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { childId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes the entire forward chain starting at `sessionId`. Sessions form a
 *  singly linked list via `replacedById` on each rotation, so on replay we walk
 *  from the presented (stale) session to the end and revoke every node — not
 *  just the immediate successor. */
async function revokeLineage(sessionId: string): Promise<void> {
  const ids: string[] = [];
  let cursor: string | null = sessionId;

  while (cursor !== null) {
    const node: { id: string; replacedById: string | null } | null =
      await prisma.authSession.findUnique({
        where: { id: cursor },
        select: { id: true, replacedById: true },
      });
    if (!node) break;
    ids.push(node.id);
    cursor = node.replacedById;
  }

  if (ids.length) {
    await prisma.authSession.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// ── User Story 1: Parent auth ─────────────────────────────────────────────────

export async function registerParent(params: {
  familyName: string;
  fullName: string;
  email: string;
  password: string;
  dob: Date;
  country?: string;
}): Promise<TokenPair> {
  const { familyName, fullName, email, password, dob } = params;
  const country = params.country;

  const age = (Date.now() - dob.getTime()) / (365.25 * 86400 * 1000);
  if (age < 18) throw UNPROCESSABLE("Must be 18 or older to register");

  const existing = await prisma.parent.findUnique({ where: { email } });
  if (existing) throw CONFLICT("Email already in use");

  const passwordHash = await hashSecret(password);
  const verifyToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(verifyToken).digest("hex");

  let familyId: string;
  let parentId: string;

  await prisma.$transaction(async (tx) => {
    const fam = await tx.family.create({ data: { name: familyName } });
    familyId = fam.id;

    const parent = await tx.parent.create({
      data: {
        familyId: fam.id,
        role: "OWNER",
        fullName,
        email,
        passwordHash,
        dob,
        ...(country !== undefined ? { country } : {}),
      },
    });
    parentId = parent.id;

    await tx.emailVerificationToken.create({
      data: {
        parentId: parent.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
  });

  sendVerificationEmail(email, verifyToken);

  return issueSessionPair({
    principalId: parentId!,
    principalType: "parent",
    role: "owner",
    familyId: familyId!,
  });
}

export async function loginParent(params: {
  email: string;
  password: string;
  deviceLabel?: string;
}): Promise<TokenPair> {
  const { email, password } = params;
  const deviceLabel = params.deviceLabel;

  const emailKey = `email:${email.toLowerCase()}`;
  if (await isLocked(emailKey)) throw LOCKED();

  const parent = await prisma.parent.findUnique({ where: { email } });

  if (!parent || !parent.passwordHash) {
    await dummyVerify();
    await recordFailure(emailKey);
    throw UNAUTHORIZED();
  }

  const accountKey = `parent:${parent.id}`;
  if (await isLocked(accountKey)) throw LOCKED();

  const valid = await verifySecret(parent.passwordHash, password);
  if (!valid) {
    await recordFailure(emailKey);
    await recordFailure(accountKey);
    throw UNAUTHORIZED();
  }

  await clearLockout(emailKey);
  await clearLockout(accountKey);

  // FR-014: a family pending deletion cannot mint new tokens (access revoked at request).
  await assertFamilyNotPendingDeletion(parent.familyId);

  return issueSessionPair({
    principalId: parent.id,
    principalType: "parent",
    role: parent.role === "OWNER" ? "owner" : "co_parent",
    familyId: parent.familyId,
    ...(deviceLabel !== undefined ? { deviceLabel } : {}),
  });
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const record = await prisma.emailVerificationToken.findFirst({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
  });

  if (!record) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, "Invalid or expired verification token");
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.parent.update({
      where: { id: record.parentId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);
}

export async function getMe(principalId: string, principalType: PrincipalType) {
  if (principalType === "parent") {
    const parent = await prisma.parent.findUniqueOrThrow({ where: { id: principalId } });
    return {
      id: parent.id,
      type: "parent",
      role: parent.role,
      email: parent.email,
      fullName: parent.fullName,
      familyId: parent.familyId,
      emailVerifiedAt: parent.emailVerifiedAt,
    };
  } else {
    const child = await prisma.child.findUniqueOrThrow({ where: { id: principalId } });
    return {
      id: child.id,
      type: "child",
      username: child.username,
      displayName: child.displayName,
      familyId: child.familyId,
    };
  }
}

// ── User Story 2: Child auth ──────────────────────────────────────────────────

export async function loginChild(params: {
  username: string;
  password?: string;
  pin?: string;
  deviceLabel?: string;
}): Promise<TokenPair> {
  const { username } = params;
  const password = params.password;
  const pin = params.pin;
  const deviceLabel = params.deviceLabel;

  const usernameNorm = username.toLowerCase();
  const usernameKey = `username:${usernameNorm}`;
  if (await isLocked(usernameKey)) throw LOCKED();

  const child = await prisma.child.findUnique({ where: { usernameNormalized: usernameNorm } });

  if (!child) {
    await dummyVerify();
    await recordFailure(usernameKey);
    throw UNAUTHORIZED();
  }

  const accountKey = `child:${child.id}`;
  if (await isLocked(accountKey)) throw LOCKED();

  let valid = false;
  if (password !== undefined && child.passwordHash !== null) {
    valid = await verifySecret(child.passwordHash, password);
  } else if (pin !== undefined && child.pinHash !== null) {
    valid = await verifySecret(child.pinHash, pin);
  } else {
    await dummyVerify();
  }

  if (!valid) {
    await recordFailure(usernameKey);
    await recordFailure(accountKey);
    throw UNAUTHORIZED();
  }

  await clearLockout(usernameKey);
  await clearLockout(accountKey);

  // FR-014: a child of a family pending deletion cannot mint new tokens either.
  await assertFamilyNotPendingDeletion(child.familyId);

  return issueSessionPair({
    principalId: child.id,
    principalType: "child",
    role: "child",
    familyId: child.familyId,
    ...(deviceLabel !== undefined ? { deviceLabel } : {}),
  });
}

// ── User Story 3: Family scope assertion ──────────────────────────────────────

export function assertFamilyScope(principalFamilyId: string, resourceFamilyId: string): void {
  if (principalFamilyId !== resourceFamilyId) {
    throw new AppError(403, ErrorCode.FORBIDDEN, "Access denied");
  }
}

// ── User Story 4: Update child credentials ────────────────────────────────────

export async function updateChildCredentials(
  parentFamilyId: string,
  childId: string,
  updates: { username?: string; password?: string; pin?: string },
): Promise<void> {
  const child = await prisma.child.findUnique({ where: { id: childId } });
  if (!child) throw new AppError(404, ErrorCode.NOT_FOUND, "Child not found");
  assertFamilyScope(parentFamilyId, child.familyId);

  const data: {
    username?: string;
    usernameNormalized?: string;
    passwordHash?: string;
    pinHash?: string;
  } = {};

  if (updates.username !== undefined) {
    const usernameNormalized = updates.username.toLowerCase();
    const conflict = await prisma.child.findUnique({ where: { usernameNormalized } });
    if (conflict && conflict.id !== childId) throw CONFLICT("Username already taken");
    data.username = updates.username;
    data.usernameNormalized = usernameNormalized;
  }

  if (updates.password !== undefined) {
    data.passwordHash = await hashSecret(updates.password);
  }

  if (updates.pin !== undefined) {
    data.pinHash = await hashSecret(updates.pin);
  }

  await prisma.$transaction([
    prisma.child.update({ where: { id: childId }, data }),
    prisma.authSession.updateMany({
      where: { childId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

// ── User Story 5: Shared device ───────────────────────────────────────────────

export async function listFamilyChildrenForPicker(familyId: string) {
  return prisma.child.findMany({
    where: { familyId, deletedAt: null },
    select: { id: true, displayName: true, username: true, status: true },
  });
}

export async function reauthParent(
  parentId: string,
  deviceId: string,
  password: string,
): Promise<void> {
  // `parentId` is the verified principal's own id (from requireAuth), so no
  // family-scope check is needed — a parent can only re-auth as themselves.
  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent || !parent.passwordHash) throw UNAUTHORIZED();

  const valid = await verifySecret(parent.passwordHash, password);
  if (!valid) throw UNAUTHORIZED();

  const r = getRedis();
  if (r) {
    try {
      await r.set(`reauth:${parentId}:${deviceId}`, "1", "EX", reauthWindowSeconds());
    } catch {
      // Redis unavailable — reauth marker not stored (fail-open for dev/test)
    }
  }
}

// ── User Story 6: OAuth ───────────────────────────────────────────────────────

export async function findOrCreateByOAuth(profile: {
  provider: "GOOGLE" | "APPLE";
  providerAccountId: string;
  email: string | undefined;
  name?: string;
}): Promise<{ status: "session"; tokens: TokenPair } | { status: "needs_dob"; dobToken: string }> {
  const { provider, providerAccountId } = profile;
  const email = profile.email;
  const name = profile.name;

  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { parent: true },
  });

  if (existing) {
    const parent = existing.parent;
    if (!parent.dob) return { status: "needs_dob", dobToken: signDobPending(parent.id) };

    const tokens = await issueSessionPair({
      principalId: parent.id,
      principalType: "parent",
      role: parent.role === "OWNER" ? "owner" : "co_parent",
      familyId: parent.familyId,
    });
    return { status: "session", tokens };
  }

  const displayName = name ?? email ?? "New User";
  const family = await prisma.family.create({ data: { name: `${displayName}'s Family` } });
  const placeholderEmail =
    email ?? `${provider.toLowerCase()}-${providerAccountId}@placeholder.invalid`;

  const parent = await prisma.parent.create({
    data: {
      familyId: family.id,
      role: "OWNER",
      fullName: displayName,
      email: placeholderEmail,
    },
  });

  await prisma.oAuthAccount.create({
    data: {
      parentId: parent.id,
      provider,
      providerAccountId,
      ...(email !== undefined ? { email } : {}),
    },
  });

  return { status: "needs_dob", dobToken: signDobPending(parent.id) };
}

export async function completeOAuthDob(dobToken: string, dob: Date): Promise<TokenPair> {
  let parentId: string;
  try {
    parentId = verifyDobPending(dobToken).sub;
  } catch {
    throw UNAUTHORIZED("Invalid or expired token");
  }

  const age = (Date.now() - dob.getTime()) / (365.25 * 86400 * 1000);
  if (age < 18) throw UNPROCESSABLE("Must be 18 or older");

  const parent = await prisma.parent.update({ where: { id: parentId }, data: { dob } });

  return issueSessionPair({
    principalId: parent.id,
    principalType: "parent",
    role: parent.role === "OWNER" ? "owner" : "co_parent",
    familyId: parent.familyId,
  });
}
