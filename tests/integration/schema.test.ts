import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/db/prisma.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("schema smoke test", () => {
  it("can query every entity without error", async () => {
    await expect(prisma.family.findMany()).resolves.toBeDefined();
    await expect(prisma.parent.findMany()).resolves.toBeDefined();
    await expect(prisma.child.findMany()).resolves.toBeDefined();
    await expect(prisma.plan.findMany()).resolves.toBeDefined();
    await expect(prisma.subscription.findMany()).resolves.toBeDefined();
    await expect(prisma.invoice.findMany()).resolves.toBeDefined();
    await expect(prisma.session.findMany()).resolves.toBeDefined();
    await expect(prisma.subjectProgress.findMany()).resolves.toBeDefined();
    await expect(prisma.topicProgress.findMany()).resolves.toBeDefined();
    await expect(prisma.homework.findMany()).resolves.toBeDefined();
    await expect(prisma.reminderConfig.findMany()).resolves.toBeDefined();
    await expect(prisma.badge.findMany()).resolves.toBeDefined();
    await expect(prisma.notification.findMany()).resolves.toBeDefined();
    await expect(prisma.reward.findMany()).resolves.toBeDefined();
    await expect(prisma.conversation.findMany()).resolves.toBeDefined();
    await expect(prisma.message.findMany()).resolves.toBeDefined();
    await expect(prisma.consentRecord.findMany()).resolves.toBeDefined();
  });

  it("rejects an orphaned family-owned row (Child without Family)", async () => {
    await expect(
      prisma.child.create({
        data: {
          familyId: "nonexistent-family-id",
          displayName: "Orphan",
          dob: new Date("2010-01-01"),
          gender: "MALE",
          country: "Saudi Arabia",
          grade: "Grade 5",
          curriculum: "BRITISH",
          subjects: [],
          username: "orphan.test",
          usernameNormalized: "orphan.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces usernameNormalized uniqueness", async () => {
    const family = await prisma.family.create({ data: { name: "Test Family" } });
    await prisma.child.create({
      data: {
        familyId: family.id,
        displayName: "Test",
        dob: new Date("2012-01-01"),
        gender: "MALE",
        country: "Saudi Arabia",
        grade: "Grade 6",
        curriculum: "BRITISH",
        subjects: [],
        username: "unique.test",
        usernameNormalized: "unique.test",
      },
    });

    await expect(
      prisma.child.create({
        data: {
          familyId: family.id,
          displayName: "Test2",
          dob: new Date("2012-01-01"),
          gender: "FEMALE",
          country: "Saudi Arabia",
          grade: "Grade 6",
          curriculum: "BRITISH",
          subjects: [],
          username: "Unique.Test",
          usernameNormalized: "unique.test",
        },
      }),
    ).rejects.toThrow();

    await prisma.child.deleteMany({ where: { familyId: family.id } });
    await prisma.family.delete({ where: { id: family.id } });
  });
});
