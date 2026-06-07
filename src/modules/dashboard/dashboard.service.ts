import {
  Prisma,
  type Badge as BadgeModel,
  type Child,
  type Homework,
  type Session as SessionModel,
  type SubjectProgress as SubjectProgressModel,
  type TopicProgress,
} from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { NotFoundError } from "../../lib/errors.js";
import {
  displayDate,
  durationLabel,
  homeworkDaysInfo,
  relativeDateTime,
  relativeTime,
} from "../../lib/time.js";
import {
  mergeFamilyReminderConfigs,
  reminderEntryForSlug,
  recipientEnumForLabel,
} from "../../lib/reminders.js";
import type {
  Badge,
  ChildListItem,
  ChildOverview,
  ChildProfile,
  HomeSummary,
  HomeworkItem,
  ReminderEntry,
  SessionItem,
  SettingsPayload,
  SubjectProgress,
} from "./dashboard.schema.js";

// ── Family scoping guard (Principle I, research.md §2) ────────────────────────
//
// Loading the child with a combined { id, familyId } where makes a foreign childId
// indistinguishable from a missing one (404, no cross-family leak). Every per-child
// sub-query runs only after this passes.

export async function assertChildInFamily(familyId: string, childId: string): Promise<Child> {
  const child = await prisma.child.findFirst({
    where: { id: childId, familyId, deletedAt: null },
  });
  if (!child) {
    throw new NotFoundError("Child not found");
  }
  return child;
}

// ── Shared mappers ────────────────────────────────────────────────────────────

function ageFromDob(dob: Date, now: Date): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function statusLabel(status: Child["status"]): "active" | "paused" {
  return status === "PAUSED" ? "paused" : "active";
}

function countHomework(homework: Pick<Homework, "status">[]): {
  pending: number;
  completed: number;
  overdue: number;
} {
  let pending = 0;
  let completed = 0;
  let overdue = 0;
  for (const hw of homework) {
    switch (hw.status) {
      case "PENDING":
      case "IN_PROGRESS":
        pending += 1;
        break;
      case "COMPLETED":
      case "COMPLETED_LATE":
        completed += 1;
        break;
      case "OVERDUE":
        overdue += 1;
        break;
    }
  }
  return { pending, completed, overdue };
}

interface OverviewSources {
  child: Child;
  latestSession: Pick<SessionModel, "subject" | "startedAt"> | null;
  homework: Pick<Homework, "status">[];
  hasStruggleAlert: boolean;
}

/** Maps a Child row + bounded per-child sources into the ChildOverview shape (§B). */
function mapChildOverview(sources: OverviewSources, now: Date): ChildOverview {
  const { child, latestSession, homework, hasStruggleAlert } = sources;
  return {
    id: child.id,
    name: child.displayName,
    grade: child.grade,
    minutesThisWeek: child.minutesThisWeek,
    sessions: child.sessionsThisWeek,
    streak: child.streak,
    topSubject: child.topSubject,
    lastSession: latestSession
      ? { subject: latestSession.subject, when: relativeTime(latestSession.startedAt, now) }
      : null,
    homework: countHomework(homework),
    hasStruggleAlert,
    status: statusLabel(child.status),
  };
}

/**
 * Builds ChildOverview/ChildListItem entries for a set of children in a bounded
 * number of queries (no N+1): one each for latest sessions, homework statuses, and
 * struggle flags across all the given children, grouped in memory.
 */
async function buildOverviews(children: Child[], now: Date): Promise<ChildListItem[]> {
  if (children.length === 0) return [];

  const childIds = children.map((c) => c.id);

  // Latest session per child: pull each child's sessions newest-first and keep the
  // first seen per child. Result sets are tiny at seed scale.
  const sessions = await prisma.session.findMany({
    where: { childId: { in: childIds } },
    orderBy: { startedAt: "desc" },
    select: { childId: true, subject: true, startedAt: true },
  });
  const latestByChild = new Map<string, { subject: string; startedAt: Date }>();
  for (const s of sessions) {
    if (!latestByChild.has(s.childId)) {
      latestByChild.set(s.childId, { subject: s.subject, startedAt: s.startedAt });
    }
  }

  const homework = await prisma.homework.findMany({
    where: { childId: { in: childIds } },
    select: { childId: true, status: true },
  });
  const homeworkByChild = new Map<string, { status: Homework["status"] }[]>();
  for (const hw of homework) {
    const list = homeworkByChild.get(hw.childId);
    if (list) list.push({ status: hw.status });
    else homeworkByChild.set(hw.childId, [{ status: hw.status }]);
  }

  const strugglingRows = await prisma.topicProgress.findMany({
    where: { struggling: true, subjectProgress: { childId: { in: childIds } } },
    select: { subjectProgress: { select: { childId: true } } },
  });
  const struggleChildIds = new Set(strugglingRows.map((r) => r.subjectProgress.childId));

  return children.map((child) => {
    const overview = mapChildOverview(
      {
        child,
        latestSession: latestByChild.get(child.id) ?? null,
        homework: homeworkByChild.get(child.id) ?? [],
        hasStruggleAlert: struggleChildIds.has(child.id),
      },
      now,
    );
    return {
      ...overview,
      displayName: child.displayName,
      age: ageFromDob(child.dob, now),
      username: child.username,
    };
  });
}

// ── US1: Home summary (§A) ────────────────────────────────────────────────────

export async function getHomeSummary(
  familyId: string,
  now: Date = new Date(),
): Promise<HomeSummary> {
  const children = await prisma.child.findMany({
    where: { familyId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  const overviews = await buildOverviews(children, now);

  const minutesThisWeek = children.reduce((sum, c) => sum + c.minutesThisWeek, 0);

  const mostActiveChild = children.reduce<Child | null>((best, c) => {
    if (!best || c.streak > best.streak) return c;
    return best;
  }, null);

  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const homeworkDueSoon = await prisma.homework.count({
    where: {
      familyId,
      deadline: { lte: in48h },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });

  const unreadNotifications = await prisma.notification.count({
    where: { familyId, recipient: "PARENT", readAt: null },
  });

  return {
    stats: {
      minutesThisWeek,
      mostActive: {
        name: mostActiveChild ? mostActiveChild.displayName : null,
        streakDays: mostActiveChild ? mostActiveChild.streak : 0,
      },
      homeworkDueSoon,
      unreadNotifications,
    },
    // The overview shape is the strict ChildOverview subset of ChildListItem.
    children: overviews.map(({ displayName: _d, age: _a, username: _u, ...overview }) => overview),
  };
}

// ── US2: Children list (§B note) ──────────────────────────────────────────────

export async function listChildren(
  familyId: string,
  now: Date = new Date(),
): Promise<ChildListItem[]> {
  const children = await prisma.child.findMany({
    where: { familyId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return buildOverviews(children, now);
}

/**
 * Maps a single Child row into the Phase 3 ChildListItem shape so write endpoints
 * (e.g. POST /children) can return a payload the FE children-list cache slots in.
 */
export async function mapChildToListItem(
  child: Child,
  now: Date = new Date(),
): Promise<ChildListItem> {
  const [item] = await buildOverviews([child], now);
  return item!;
}

// ── US3: Child profile (§C) ───────────────────────────────────────────────────

const CURRICULUM_LABELS: Record<Child["curriculum"], string> = {
  BRITISH: "British",
  AMERICAN: "American",
  IB: "IB",
  SAUDI_NATIONAL: "Saudi National",
};

function trendLabel(trend: SubjectProgressModel["trend"]): "up" | "down" | "flat" {
  switch (trend) {
    case "UP":
      return "up";
    case "DOWN":
      return "down";
    case "FLAT":
    default:
      return "flat";
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Overview block of the profile (§C1) — direct Child-row mapping + derived display. */
function mapProfileOverview(
  child: Child,
  now: Date,
): Omit<ChildProfile, "subjectProgress" | "homework" | "sessions" | "badges"> {
  return {
    id: child.id,
    name: child.displayName,
    displayName: child.displayName,
    grade: child.grade,
    age: ageFromDob(child.dob, now),
    status: statusLabel(child.status),
    dob: displayDate(child.dob, "dob"),
    gender: titleCase(child.gender),
    country: child.country,
    curriculum: CURRICULUM_LABELS[child.curriculum],
    subjects: child.subjects,
    username: child.username,
    minutesThisWeek: child.minutesThisWeek,
    sessionsThisWeek: child.sessionsThisWeek,
    streak: child.streak,
    totalXP: child.totalXp,
    totalMinutes: child.totalMinutes,
    badgesThisMonth: child.badgesThisMonth,
    masteryPercentage: child.masteryPercentage,
    coveragePercentage: child.coveragePercentage,
    trendVsLastWeek: child.trendVsLastWeek,
    bedtimeCutoff: child.bedtimeCutoff,
    allowedDays: child.allowedDays,
    blockedSubjects: child.blockedSubjects,
    level: child.level,
    levelXp: child.levelXp,
    levelMax: child.levelMax,
    nextLevel: child.nextLevel,
    streakTokens: child.streakTokens,
  };
}

type SubjectProgressWithTopics = SubjectProgressModel & { topics: TopicProgress[] };

/** subjectProgress builder (§C2) — pairs SubjectProgress rows with per-subject recent sessions. */
function buildSubjectProgress(
  rows: SubjectProgressWithTopics[],
  sessions: SessionModel[],
  now: Date,
): SubjectProgress[] {
  // Group sessions by subject, newest first already (caller orders desc).
  const sessionsBySubject = new Map<string, SessionModel[]>();
  for (const s of sessions) {
    const list = sessionsBySubject.get(s.subject);
    if (list) list.push(s);
    else sessionsBySubject.set(s.subject, [s]);
  }

  return rows.map((row) => {
    const recent = (sessionsBySubject.get(row.subject) ?? []).slice(0, 3).map((s) => {
      const entry: SubjectProgress["recentSessions"][number] = {
        date: relativeTime(s.startedAt, now),
        duration: durationLabel(s.durationMinutes),
      };
      if (s.score != null) entry.score = s.score;
      return entry;
    });

    return {
      subject: row.subject,
      mastery: row.mastery,
      coverage: row.coverage,
      trend: trendLabel(row.trend),
      lastStudied: row.lastStudiedAt ? relativeTime(row.lastStudiedAt, now) : null,
      masteryHistory: row.masteryHistory,
      topics: row.topics.map((t) => ({
        name: t.name,
        mastery: t.mastery,
        struggling: t.struggling,
      })),
      recentSessions: recent,
    };
  });
}

/** homework builder (§C3). */
function buildHomework(rows: Homework[], now: Date): HomeworkItem[] {
  return rows.map((hw) => ({
    id: hw.id,
    subject: hw.subject,
    topic: hw.topic,
    deadline: displayDate(hw.deadline, "short"),
    status: hw.status.toLowerCase() as HomeworkItem["status"],
    daysInfo: homeworkDaysInfo(hw.deadline, hw.status, now),
  }));
}

/** Overall recent sessions builder (§C4) — take 5 newest. */
function buildSessions(rows: SessionModel[], now: Date): SessionItem[] {
  return rows.slice(0, 5).map((s) => {
    const item: SessionItem = {
      id: s.id,
      date: relativeDateTime(s.startedAt, now),
      subject: s.subject,
      duration: durationLabel(s.durationMinutes),
      topics: s.topics,
    };
    if (s.score != null) item.score = s.score;
    return item;
  });
}

/** Badges split (§C5) — earned carry a date; in-progress carry a progress block. */
function buildBadges(rows: BadgeModel[]): Badge[] {
  return rows.map((b) => {
    const badge: Badge = {
      id: b.id,
      name: b.name,
      emoji: b.emoji,
      description: b.description,
      criteria: b.criteria,
      earned: b.earned,
    };
    if (b.earned) {
      if (b.earnedAt) badge.date = displayDate(b.earnedAt, "long");
    } else if (b.progressCurrent != null && b.progressTotal != null) {
      badge.progress = {
        current: b.progressCurrent,
        total: b.progressTotal,
        unit: b.progressUnit ?? "",
      };
    }
    return badge;
  });
}

export async function getChildProfile(
  familyId: string,
  childId: string,
  now: Date = new Date(),
): Promise<ChildProfile> {
  const child = await assertChildInFamily(familyId, childId);

  const [subjectRows, sessions, homeworkRows, badgeRows] = await Promise.all([
    prisma.subjectProgress.findMany({
      where: { childId, familyId },
      include: { topics: true },
    }),
    prisma.session.findMany({
      where: { childId, familyId },
      orderBy: { startedAt: "desc" },
    }),
    prisma.homework.findMany({
      where: { childId, familyId },
      orderBy: { deadline: "desc" },
    }),
    prisma.badge.findMany({
      where: { childId, familyId },
    }),
  ]);

  return {
    ...mapProfileOverview(child, now),
    subjectProgress: buildSubjectProgress(subjectRows, sessions, now),
    homework: buildHomework(homeworkRows, now),
    sessions: buildSessions(sessions, now),
    badges: buildBadges(badgeRows),
  };
}

// ── US4: Reminder configuration (§D) ──────────────────────────────────────────

export async function getReminderConfig(familyId: string): Promise<ReminderEntry[]> {
  const configs = await prisma.reminderConfig.findMany({
    where: { familyId },
    // Stable ordering so the family-level rollup always picks the SAME child's row
    // as the representative settings (Postgres gives no order without ORDER BY, which
    // otherwise made the displayed time/days appear to change across reloads/logins).
    orderBy: { childId: "asc" },
    select: { childId: true, type: true, enabled: true, recipient: true, settings: true },
  });
  return mergeFamilyReminderConfigs(configs);
}

interface ReminderUpdate {
  enabled?: boolean | undefined;
  settings?: Record<string, unknown> | undefined;
}

/**
 * Persist a reminder change at the family level (US4 write). The screen shows one
 * family-level row per type (enabled = OR across the family's children, settings from
 * a representative row — see mergeFamilyReminderConfigs); writing the inverse here
 * applies the change to every non-deleted child's ReminderConfig row for that type.
 * `enabled` is set directly; `settings` is merged into each child's existing settings
 * (so changing days doesn't wipe time). Children missing a row for the type get one
 * created with the catalog's default recipient, so the change reliably persists for
 * all 9 types. Returns the refreshed family-level list. A `slug` outside the catalog
 * is a 404.
 */
export async function updateReminder(
  familyId: string,
  slug: string,
  update: ReminderUpdate,
): Promise<ReminderEntry[]> {
  const entry = reminderEntryForSlug(slug);
  if (!entry) {
    throw new NotFoundError("Reminder not found");
  }

  const children = await prisma.child.findMany({
    where: { familyId, deletedAt: null },
    select: {
      id: true,
      reminderConfigs: {
        where: { type: entry.type },
        select: { settings: true },
      },
    },
  });

  const defaultRecipient = recipientEnumForLabel(entry.defaultRecipient);

  await prisma.$transaction(
    children.map((child) => {
      // Merge settings over the child's existing settings so a partial update (e.g.
      // just `days`) preserves the other keys (e.g. `time`).
      const existing = (child.reminderConfigs[0]?.settings ?? {}) as Record<string, unknown>;
      const mergedSettings: Prisma.InputJsonValue | undefined =
        update.settings !== undefined
          ? ({ ...existing, ...update.settings } as Prisma.InputJsonValue)
          : undefined;

      const updateData: Prisma.ReminderConfigUpdateInput = {
        ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
        ...(mergedSettings !== undefined ? { settings: mergedSettings } : {}),
      };

      const createData: Prisma.ReminderConfigUncheckedCreateInput = {
        familyId,
        childId: child.id,
        type: entry.type,
        enabled: update.enabled ?? false,
        recipient: defaultRecipient,
        ...(mergedSettings !== undefined ? { settings: mergedSettings } : {}),
      };

      return prisma.reminderConfig.upsert({
        where: { childId_type: { childId: child.id, type: entry.type } },
        update: updateData,
        create: createData,
      });
    }),
  );

  return getReminderConfig(familyId);
}

// ── US5: Settings (§E) ────────────────────────────────────────────────────────

function formatPrice(minor: number, currency: string, cycle: "monthly" | "yearly"): string {
  const whole = Math.round(minor / 100);
  const grouped = whole.toLocaleString("en-US");
  return `${currency} ${grouped} / ${cycle === "yearly" ? "year" : "month"}`;
}

export async function getSettings(familyId: string, parentId: string): Promise<SettingsPayload> {
  const parent = await prisma.parent.findFirst({
    where: { id: parentId, familyId },
  });
  if (!parent) {
    throw new NotFoundError("Account not found");
  }

  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true },
  });

  const childrenUsed = await prisma.child.count({
    where: { familyId, deletedAt: null },
  });

  const phone =
    parent.phoneCountry && parent.phoneNumber
      ? `${parent.phoneCountry} ${parent.phoneNumber}`
      : (parent.phoneNumber ?? parent.phoneCountry ?? null);

  const account: SettingsPayload["account"] = {
    fullName: parent.fullName,
    email: parent.email,
    phone,
    phoneCountry: parent.phoneCountry,
    phoneNumber: parent.phoneNumber,
    country: parent.country,
    language: parent.language,
  };

  const notificationPrefs: SettingsPayload["notificationPrefs"] = {
    push: parent.notifyPush,
    email: parent.notifyEmail,
    whatsapp: parent.notifyWhatsapp,
  };

  if (!subscription || !subscription.plan) {
    return {
      account,
      notificationPrefs,
      subscription: {
        planName: "",
        childLimit: 0,
        childrenUsed,
        priceLabel: "",
        currency: "",
        billingCycle: "monthly",
        renewalDate: "",
        status: "",
      },
    };
  }

  const cycle: "monthly" | "yearly" = subscription.billingCycle === "YEARLY" ? "yearly" : "monthly";
  const priceMinor =
    cycle === "yearly" ? subscription.plan.yearlyPriceMinor : subscription.plan.monthlyPriceMinor;

  return {
    account,
    notificationPrefs,
    subscription: {
      planName: `${subscription.plan.name} Plan`,
      childLimit: subscription.plan.childLimit,
      childrenUsed,
      priceLabel: formatPrice(priceMinor, subscription.plan.currency, cycle),
      currency: subscription.plan.currency,
      billingCycle: cycle,
      renewalDate: displayDate(subscription.currentPeriodEnd, "long"),
      status: subscription.status.toLowerCase(),
    },
  };
}
