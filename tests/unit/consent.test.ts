import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { recordConsent, hasValidConsent } from "../../src/lib/consent.js";

// Append-only consent (FR-005–007, research.md §5): recordConsent NEVER overwrites — a
// re-consent appends a new row; hasValidConsent returns the latest-by-grantedAt record.

let familyId: string;
let parentId: string;

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "consent-unit-family" } });
  familyId = family.id;
  const parent = await prisma.parent.create({
    data: {
      familyId,
      role: "OWNER",
      fullName: "Consent Parent",
      email: `consent.${Math.random().toString(36).slice(2)}@test.consent`,
      dob: new Date("1985-01-01"),
    },
  });
  parentId = parent.id;
});

afterEach(async () => {
  await prisma.consentRecord.deleteMany({ where: { familyId } });
  await prisma.parent.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("recordConsent (append-only)", () => {
  it("re-consent appends a new row and never overwrites the prior one", async () => {
    await recordConsent(prisma, { familyId, parentId, type: "TERMS", version: "1.0" });
    await recordConsent(prisma, { familyId, parentId, type: "TERMS", version: "2.0" });

    const rows = await prisma.consentRecord.findMany({
      where: { familyId, type: "TERMS" },
      orderBy: { version: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.version)).toEqual(["1.0", "2.0"]);
  });

  it("does not invent a parentId/childId when omitted", async () => {
    await recordConsent(prisma, { familyId, type: "PRIVACY", version: "1.0" });
    const row = await prisma.consentRecord.findFirst({ where: { familyId, type: "PRIVACY" } });
    expect(row?.parentId).toBeNull();
    expect(row?.childId).toBeNull();
  });
});

describe("hasValidConsent", () => {
  it("returns false when no record exists for the scope", async () => {
    expect(await hasValidConsent(familyId, null, "COPPA")).toBe(false);
  });

  it("returns true once a matching record is appended (latest-by-grantedAt)", async () => {
    await recordConsent(prisma, {
      familyId,
      parentId,
      type: "COPPA",
      version: "1.0",
      grantedAt: new Date("2026-01-01"),
    });
    expect(await hasValidConsent(familyId, null, "COPPA")).toBe(true);
    // A child-scoped lookup is distinct from the parent-level (childId: null) one.
    expect(await hasValidConsent(familyId, "nonexistent-child", "COPPA")).toBe(false);
  });
});
