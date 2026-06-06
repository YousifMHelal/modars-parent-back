import { PrismaClient } from "@prisma/client";
import {
  FAMILY_DATA,
  PARENT_DATA,
  PLANS_DATA,
  SUBSCRIPTION_DATA,
  INVOICES_DATA,
  AHMED_DATA,
  LAYLA_DATA,
  AHMED_SUBJECT_PROGRESS,
  LAYLA_SUBJECT_PROGRESS,
  ahmedSessions,
  laylaSessions,
  ahmedHomework,
  laylaHomework,
  AHMED_BADGES,
  LAYLA_BADGES,
  REMINDER_CONFIGS,
  notificationsData,
} from "./seed/mock-data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // ── Reset in FK-safe (child-first) order ─────────────────────────────────
    await tx.message.deleteMany();
    await tx.conversation.deleteMany();
    await tx.consentRecord.deleteMany();
    await tx.reward.deleteMany();
    await tx.notification.deleteMany();
    await tx.badge.deleteMany();
    await tx.reminderConfig.deleteMany();
    await tx.homework.deleteMany();
    await tx.topicProgress.deleteMany();
    await tx.subjectProgress.deleteMany();
    await tx.session.deleteMany();
    await tx.invoice.deleteMany();
    await tx.subscription.deleteMany();
    await tx.child.deleteMany();
    // Phase 2: delete auth-related records before parents/families
    await tx.emailVerificationToken.deleteMany();
    await tx.oAuthAccount.deleteMany();
    // Null out self-FK before bulk delete
    await tx.authSession.updateMany({ data: { replacedById: null } });
    await tx.authSession.deleteMany();
    await tx.parent.deleteMany();
    await tx.family.deleteMany();
    await tx.plan.deleteMany();

    // ── Plans ─────────────────────────────────────────────────────────────────
    for (const plan of PLANS_DATA) {
      await tx.plan.create({ data: plan });
    }
    const familyPlan = await tx.plan.findUniqueOrThrow({ where: { key: "FAMILY" } });

    // ── Family ────────────────────────────────────────────────────────────────
    const family = await tx.family.create({ data: FAMILY_DATA });

    // ── Parent ────────────────────────────────────────────────────────────────
    await tx.parent.create({ data: { ...PARENT_DATA, familyId: family.id } });

    // ── Children ──────────────────────────────────────────────────────────────
    const ahmed = await tx.child.create({ data: { ...AHMED_DATA, familyId: family.id } });
    const layla = await tx.child.create({ data: { ...LAYLA_DATA, familyId: family.id } });

    // ── Subscription + Invoices ───────────────────────────────────────────────
    const subscription = await tx.subscription.create({
      data: { ...SUBSCRIPTION_DATA, familyId: family.id, planId: familyPlan.id },
    });
    for (const invoice of INVOICES_DATA) {
      await tx.invoice.create({ data: { ...invoice, subscriptionId: subscription.id } });
    }

    // ── Sessions ──────────────────────────────────────────────────────────────
    for (const s of ahmedSessions()) {
      await tx.session.create({ data: { ...s, familyId: family.id, childId: ahmed.id } });
    }
    for (const s of laylaSessions()) {
      await tx.session.create({ data: { ...s, familyId: family.id, childId: layla.id } });
    }

    // ── SubjectProgress + TopicProgress ───────────────────────────────────────
    for (const sp of AHMED_SUBJECT_PROGRESS) {
      const { topics, ...spData } = sp;
      const created = await tx.subjectProgress.create({
        data: { ...spData, familyId: family.id, childId: ahmed.id },
      });
      for (const t of topics) {
        await tx.topicProgress.create({ data: { ...t, subjectProgressId: created.id } });
      }
    }
    for (const sp of LAYLA_SUBJECT_PROGRESS) {
      const { topics, ...spData } = sp;
      const created = await tx.subjectProgress.create({
        data: { ...spData, familyId: family.id, childId: layla.id },
      });
      for (const t of topics) {
        await tx.topicProgress.create({ data: { ...t, subjectProgressId: created.id } });
      }
    }

    // ── Homework ──────────────────────────────────────────────────────────────
    for (const hw of ahmedHomework()) {
      await tx.homework.create({ data: { ...hw, familyId: family.id, childId: ahmed.id } });
    }
    for (const hw of laylaHomework()) {
      await tx.homework.create({ data: { ...hw, familyId: family.id, childId: layla.id } });
    }

    // ── Badges ────────────────────────────────────────────────────────────────
    for (const b of AHMED_BADGES) {
      await tx.badge.create({ data: { ...b, familyId: family.id, childId: ahmed.id } });
    }
    for (const b of LAYLA_BADGES) {
      await tx.badge.create({ data: { ...b, familyId: family.id, childId: layla.id } });
    }

    // ── ReminderConfigs (both children get the full set of 9) ─────────────────
    for (const childId of [ahmed.id, layla.id]) {
      for (const rc of REMINDER_CONFIGS) {
        await tx.reminderConfig.create({
          data: { ...rc, settings: rc.settings ?? undefined, familyId: family.id, childId },
        });
      }
    }

    // ── Notifications (5 unread) ──────────────────────────────────────────────
    for (const n of notificationsData()) {
      await tx.notification.create({ data: { ...n, familyId: family.id } });
    }
  });

  console.log("✓ Seed complete: Sarah Ahmed family loaded");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
