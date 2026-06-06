import prisma from "../db/prisma.js";
import { Prisma, type ConsentType } from "../generated/prisma/client.js";

// Append-only consent capture + lookup (research.md §5, data-model.md §D).
//
// This is the ONLY consent-write path (FR-006): `recordConsent` always CREATEs a new
// row — it never updates an existing one — so re-consent appends rather than overwrites
// and the full history is preserved. "Current" consent for a (familyId, childId?, type)
// scope is DERIVED as the latest record by grantedAt (tie-broken by createdAt); there is
// no mutable `current` flag. Onboarding and any future consent UI share this one helper.

export interface RecordConsentInput {
  familyId: string;
  parentId?: string;
  childId?: string;
  type: ConsentType;
  version: string;
  grantedAt?: Date;
}

/**
 * Append a consent record (never overwrites — FR-006). Accepts an optional transaction
 * client so callers can write consent atomically alongside onboarding/child-create
 * writes; falls back to the shared prisma client otherwise.
 */
export async function recordConsent(
  tx: Prisma.TransactionClient | typeof prisma,
  input: RecordConsentInput,
): Promise<void> {
  await tx.consentRecord.create({
    data: {
      familyId: input.familyId,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.childId !== undefined ? { childId: input.childId } : {}),
      type: input.type,
      version: input.version,
      grantedAt: input.grantedAt ?? new Date(),
    },
  });
}

/**
 * True iff a consent record exists for the required scope. The latest-by-grantedAt record
 * is authoritative (supersession is derived, never stored). `childId` is matched exactly:
 * pass a child id for a per-child consent gate, or omit it for a family/parent-level one.
 */
export async function hasValidConsent(
  familyId: string,
  childId: string | null,
  type: ConsentType,
): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { familyId, childId, type },
    orderBy: [{ grantedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return latest !== null;
}
