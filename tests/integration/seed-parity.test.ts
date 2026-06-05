import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import prisma from "../../src/db/prisma.js";

beforeAll(async () => {
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seed parity — Family & Parent", () => {
  it("seeds one family with two children", async () => {
    const families = await prisma.family.findMany({ include: { children: true, parents: true } });
    expect(families).toHaveLength(1);
    expect(families[0]!.children).toHaveLength(2);
    expect(families[0]!.parents).toHaveLength(1);
  });

  it("Parent Sarah Ahmed matches mock values", async () => {
    const parent = await prisma.parent.findUniqueOrThrow({ where: { email: "sarah.ahmed@example.com" } });
    expect(parent.fullName).toBe("Sarah Ahmed");
    expect(parent.role).toBe("OWNER");
  });
});

describe("seed parity — Plans", () => {
  it("seeds exactly three plans with correct prices", async () => {
    const plans = await prisma.plan.findMany({ orderBy: { monthlyPriceMinor: "asc" } });
    expect(plans).toHaveLength(3);

    const starter = plans.find((p) => p.key === "STARTER");
    expect(starter?.monthlyPriceMinor).toBe(9900);
    expect(starter?.yearlyPriceMinor).toBe(99900);
    expect(starter?.yearlyDiscountMinor).toBe(18900);
    expect(starter?.childLimit).toBe(1);
    expect(starter?.hasFreeTrial).toBe(true);

    const family = plans.find((p) => p.key === "FAMILY");
    expect(family?.monthlyPriceMinor).toBe(14900);
    expect(family?.yearlyPriceMinor).toBe(149900);
    expect(family?.yearlyDiscountMinor).toBe(28900);
    expect(family?.childLimit).toBe(4);
    expect(family?.highlighted).toBe(true);
    expect(family?.hasFreeTrial).toBe(true);

    const familyPro = plans.find((p) => p.key === "FAMILY_PRO");
    expect(familyPro?.monthlyPriceMinor).toBe(19900);
    expect(familyPro?.yearlyPriceMinor).toBe(199900);
    expect(familyPro?.yearlyDiscountMinor).toBe(38900);
    expect(familyPro?.childLimit).toBe(6);
    expect(familyPro?.hasFreeTrial).toBe(false);
  });
});

describe("seed parity — Subscription & Invoices", () => {
  it("seeds an active FAMILY yearly subscription renewing 2027-06-15", async () => {
    const sub = await prisma.subscription.findFirst({ include: { plan: true } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.billingCycle).toBe("YEARLY");
    expect(sub!.childSlotsUsed).toBe(2);
    expect(sub!.plan.key).toBe("FAMILY");
    expect(sub!.currentPeriodEnd.toISOString()).toContain("2027-06-15");
  });

  it("seeds two PAID invoices of 149900 SAR", async () => {
    const invoices = await prisma.invoice.findMany({ orderBy: { issuedAt: "desc" } });
    expect(invoices).toHaveLength(2);
    for (const inv of invoices) {
      expect(inv.amountMinor).toBe(149900);
      expect(inv.currency).toBe("SAR");
      expect(inv.status).toBe("PAID");
    }
    expect(invoices[0]!.issuedAt.toISOString()).toContain("2026-06-02");
    expect(invoices[1]!.issuedAt.toISOString()).toContain("2025-06-02");
  });
});

describe("seed parity — Home stat card aggregates", () => {
  it("total minutesThisWeek across children = 420", async () => {
    const children = await prisma.child.findMany();
    const total = children.reduce((sum, c) => sum + c.minutesThisWeek, 0);
    expect(total).toBe(420);
  });

  it("most active child is Ahmed with 12 day streak", async () => {
    const children = await prisma.child.findMany({ orderBy: { streak: "desc" } });
    expect(children[0]!.displayName).toBe("Ahmed");
    expect(children[0]!.streak).toBe(12);
  });

  it("homework due in next 48h (non-completed) = 3", async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const count = await prisma.homework.count({
      where: {
        deadline: { lte: cutoff },
        status: { notIn: ["COMPLETED", "COMPLETED_LATE", "OVERDUE"] },
      },
    });
    expect(count).toBe(3);
  });

  it("unread notifications = 5", async () => {
    const count = await prisma.notification.count({ where: { readAt: null } });
    expect(count).toBe(5);
  });
});

describe("seed parity — Child Ahmed", () => {
  it("Ahmed's snapshot stats match mock", async () => {
    const ahmed = await prisma.child.findUnique({ where: { usernameNormalized: "ahmed.modrs" } });
    expect(ahmed).not.toBeNull();
    expect(ahmed!.minutesThisWeek).toBe(240);
    expect(ahmed!.sessionsThisWeek).toBe(8);
    expect(ahmed!.streak).toBe(12);
    expect(ahmed!.topSubject).toBe("Mathematics");
    expect(ahmed!.totalXp).toBe(8450);
    expect(ahmed!.totalMinutes).toBe(3240);
    expect(ahmed!.badgesThisMonth).toBe(4);
    expect(ahmed!.masteryPercentage).toBe(68);
    expect(ahmed!.coveragePercentage).toBe(75);
    expect(ahmed!.trendVsLastWeek).toBe(15);
    expect(ahmed!.level).toBe(12);
    expect(ahmed!.levelXp).toBe(650);
    expect(ahmed!.levelMax).toBe(1000);
    expect(ahmed!.nextLevel).toBe(13);
    expect(ahmed!.streakTokens).toBe(3);
    expect(ahmed!.bedtimeCutoff).toBe("21:00");
    expect(ahmed!.allowedDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(ahmed!.blockedSubjects).toEqual([]);
  });

  it("Ahmed has 8 badges (4 earned, 4 in-progress)", async () => {
    const ahmed = await prisma.child.findUnique({ where: { usernameNormalized: "ahmed.modrs" } });
    const badges = await prisma.badge.findMany({ where: { childId: ahmed!.id } });
    expect(badges).toHaveLength(8);
    expect(badges.filter((b) => b.earned)).toHaveLength(4);
    expect(badges.filter((b) => !b.earned)).toHaveLength(4);
  });

  it("Ahmed has 9 reminder configs", async () => {
    const ahmed = await prisma.child.findUnique({ where: { usernameNormalized: "ahmed.modrs" } });
    const configs = await prisma.reminderConfig.findMany({ where: { childId: ahmed!.id } });
    expect(configs).toHaveLength(9);
  });

  it("Ahmed's Mathematics SubjectProgress matches mock", async () => {
    const ahmed = await prisma.child.findUnique({ where: { usernameNormalized: "ahmed.modrs" } });
    const sp = await prisma.subjectProgress.findUnique({ where: { childId_subject: { childId: ahmed!.id, subject: "Mathematics" } } });
    expect(sp).not.toBeNull();
    expect(sp!.mastery).toBe(68);
    expect(sp!.coverage).toBe(82);
    expect(sp!.trend).toBe("UP");
    expect(sp!.masteryHistory).toEqual([52, 58, 63, 68]);

    const topics = await prisma.topicProgress.findMany({ where: { subjectProgressId: sp!.id } });
    expect(topics).toHaveLength(5);
    const algebra = topics.find((t) => t.name === "Algebra");
    expect(algebra?.mastery).toBe(80);
    expect(algebra?.struggling).toBe(false);
    const geometry = topics.find((t) => t.name === "Geometry");
    expect(geometry?.struggling).toBe(true);
  });
});

describe("seed parity — Child Layla", () => {
  it("Layla's snapshot stats match mock", async () => {
    const layla = await prisma.child.findUnique({ where: { usernameNormalized: "layla.modrs" } });
    expect(layla).not.toBeNull();
    expect(layla!.minutesThisWeek).toBe(180);
    expect(layla!.sessionsThisWeek).toBe(6);
    expect(layla!.streak).toBe(8);
    expect(layla!.topSubject).toBe("English");
    expect(layla!.totalXp).toBe(5200);
    expect(layla!.totalMinutes).toBe(2100);
    expect(layla!.badgesThisMonth).toBe(3);
    expect(layla!.masteryPercentage).toBe(74);
    expect(layla!.coveragePercentage).toBe(80);
    expect(layla!.trendVsLastWeek).toBe(8);
    expect(layla!.level).toBe(8);
    expect(layla!.levelXp).toBe(200);
    expect(layla!.levelMax).toBe(800);
    expect(layla!.nextLevel).toBe(9);
    expect(layla!.streakTokens).toBe(1);
    expect(layla!.bedtimeCutoff).toBe("20:00");
    expect(layla!.allowedDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("Layla has 9 reminder configs", async () => {
    const layla = await prisma.child.findUnique({ where: { usernameNormalized: "layla.modrs" } });
    const configs = await prisma.reminderConfig.findMany({ where: { childId: layla!.id } });
    expect(configs).toHaveLength(9);
  });
});

describe("seed idempotency", () => {
  it("re-running the seed yields no duplicate families or children", async () => {
    execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
    const families = await prisma.family.count();
    const children = await prisma.child.count();
    expect(families).toBe(1);
    expect(children).toBe(2);
  });
});
