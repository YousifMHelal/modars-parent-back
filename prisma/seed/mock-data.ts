import {
  Curriculum,
  Gender,
  ChildStatus,
  PlanKey,
  SubscriptionStatus,
  BillingCycle,
  InvoiceStatus,
  HomeworkStatus,
  ReminderType,
  ReminderRecipient,
  NotificationRecipient,
  Trend,
} from "../../src/generated/prisma/client.js";
import { hoursAgo, daysAgo, daysFromNow } from "./helpers.js";

// ── Family & Parent ───────────────────────────────────────────────────────────

export const FAMILY_DATA = { name: "Ahmed Family" };

export const PARENT_DATA = {
  role: "OWNER" as const,
  fullName: "Sarah Ahmed",
  email: "sarah.ahmed@example.com",
  phoneCountry: "+966",
  phoneNumber: "501234567",
  country: "Saudi Arabia",
};

// ── Plans (from PlanSelectionStep.tsx PLANS) ──────────────────────────────────

export const PLANS_DATA = [
  {
    key: PlanKey.STARTER,
    name: "Starter",
    subtitle: "1 Child",
    childLimit: 1,
    monthlyPriceMinor: 9900,
    yearlyPriceMinor: 99900,
    yearlyDiscountMinor: 18900,
    currency: "SAR",
    features: [
      "1 child account",
      "Full AI voice tutor",
      "Parent dashboard",
      "Progress reports",
      "Reminders",
    ],
    highlighted: false,
    hasFreeTrial: true,
  },
  {
    key: PlanKey.FAMILY,
    name: "Family",
    subtitle: "Up to 4 Children",
    childLimit: 4,
    monthlyPriceMinor: 14900,
    yearlyPriceMinor: 149900,
    yearlyDiscountMinor: 28900,
    currency: "SAR",
    features: [
      "Up to 4 child accounts",
      "Full AI voice tutor",
      "Parent dashboard",
      "Progress reports",
      "Reminders",
      "Real-world rewards",
    ],
    highlighted: true,
    hasFreeTrial: true,
  },
  {
    key: PlanKey.FAMILY_PRO,
    name: "Family Pro",
    subtitle: "Up to 6 Children",
    childLimit: 6,
    monthlyPriceMinor: 19900,
    yearlyPriceMinor: 199900,
    yearlyDiscountMinor: 38900,
    currency: "SAR",
    features: [
      "Up to 6 child accounts",
      "Full AI voice tutor",
      "Parent dashboard",
      "Progress reports + trend charts",
      "Reminders",
      "Real-world rewards",
      "Parenting psychology insights",
      "Partner vouchers",
      "Priority support",
    ],
    highlighted: false,
    hasFreeTrial: false,
  },
];

// ── Subscription (Settings.tsx) ───────────────────────────────────────────────

export const SUBSCRIPTION_DATA = {
  status: SubscriptionStatus.ACTIVE,
  billingCycle: BillingCycle.YEARLY,
  childSlotsUsed: 2,
  currentPeriodEnd: new Date("2027-06-15"),
};

export const INVOICES_DATA = [
  {
    issuedAt: new Date("2026-06-02"),
    amountMinor: 149900,
    currency: "SAR",
    status: InvoiceStatus.PAID,
  },
  {
    issuedAt: new Date("2025-06-02"),
    amountMinor: 149900,
    currency: "SAR",
    status: InvoiceStatus.PAID,
  },
];

// ── Child: Ahmed (ChildProfile.tsx MOCK_CHILDREN["1"]) ────────────────────────

export const AHMED_DATA = {
  displayName: "Ahmed",
  dob: new Date("2011-03-15"),
  gender: Gender.MALE,
  country: "Saudi Arabia",
  grade: "Grade 8",
  curriculum: Curriculum.BRITISH,
  subjects: ["Mathematics", "Science", "English", "Arabic"],
  status: ChildStatus.ACTIVE,
  username: "ahmed.modrs",
  usernameNormalized: "ahmed.modrs",

  // Snapshot stats
  minutesThisWeek: 240,
  sessionsThisWeek: 8,
  streak: 12,
  totalXp: 8450,
  totalMinutes: 3240,
  badgesThisMonth: 4,
  masteryPercentage: 68,
  coveragePercentage: 75,
  trendVsLastWeek: 15,
  topSubject: "Mathematics",

  // Gamification
  level: 12,
  levelXp: 650,
  levelMax: 1000,
  nextLevel: 13,
  streakTokens: 3,

  // Parental controls
  bedtimeCutoff: "21:00",
  allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  blockedSubjects: [] as string[],
};

// ── Child: Layla (ChildProfile.tsx MOCK_CHILDREN["2"]) ────────────────────────

export const LAYLA_DATA = {
  displayName: "Layla",
  dob: new Date("2015-08-22"),
  gender: Gender.FEMALE,
  country: "Saudi Arabia",
  grade: "Grade 5",
  curriculum: Curriculum.BRITISH,
  subjects: ["Mathematics", "Science", "English", "Arabic"],
  status: ChildStatus.ACTIVE,
  username: "layla.modrs",
  usernameNormalized: "layla.modrs",

  // Snapshot stats
  minutesThisWeek: 180,
  sessionsThisWeek: 6,
  streak: 8,
  totalXp: 5200,
  totalMinutes: 2100,
  badgesThisMonth: 3,
  masteryPercentage: 74,
  coveragePercentage: 80,
  trendVsLastWeek: 8,
  topSubject: "English",

  // Gamification
  level: 8,
  levelXp: 200,
  levelMax: 800,
  nextLevel: 9,
  streakTokens: 1,

  // Parental controls
  bedtimeCutoff: "20:00",
  allowedDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  blockedSubjects: [] as string[],
};

// ── Ahmed's SubjectProgress + TopicProgress ───────────────────────────────────

export const AHMED_SUBJECT_PROGRESS = [
  {
    subject: "Mathematics",
    mastery: 68,
    coverage: 82,
    trend: Trend.UP,
    lastStudiedAt: hoursAgo(2),
    masteryHistory: [52, 58, 63, 68],
    topics: [
      { name: "Algebra", mastery: 80, struggling: false },
      { name: "Geometry", mastery: 45, struggling: true },
      { name: "Statistics", mastery: 72, struggling: false },
      { name: "Fractions", mastery: 38, struggling: true },
      { name: "Decimals", mastery: 90, struggling: false },
    ],
  },
  {
    subject: "Science",
    mastery: 54,
    coverage: 65,
    trend: Trend.UP,
    lastStudiedAt: daysAgo(1),
    masteryHistory: [42, 46, 50, 54],
    topics: [
      { name: "Biology", mastery: 60, struggling: false },
      { name: "Chemistry", mastery: 35, struggling: true },
      { name: "Physics", mastery: 65, struggling: false },
      { name: "Earth Science", mastery: 50, struggling: false },
    ],
  },
  {
    subject: "English",
    mastery: 72,
    coverage: 78,
    trend: Trend.FLAT,
    lastStudiedAt: daysAgo(3),
    masteryHistory: [70, 71, 72, 72],
    topics: [
      { name: "Reading Comprehension", mastery: 85, struggling: false },
      { name: "Grammar", mastery: 70, struggling: false },
      { name: "Writing", mastery: 65, struggling: false },
      { name: "Vocabulary", mastery: 75, struggling: false },
    ],
  },
  {
    subject: "Arabic",
    mastery: 45,
    coverage: 58,
    trend: Trend.DOWN,
    lastStudiedAt: daysAgo(7),
    masteryHistory: [52, 50, 47, 45],
    topics: [
      { name: "Reading", mastery: 55, struggling: false },
      { name: "Writing", mastery: 30, struggling: true },
      { name: "Grammar", mastery: 40, struggling: true },
      { name: "Vocabulary", mastery: 58, struggling: false },
    ],
  },
];

// ── Layla's SubjectProgress + TopicProgress ───────────────────────────────────

export const LAYLA_SUBJECT_PROGRESS = [
  {
    subject: "English",
    mastery: 82,
    coverage: 88,
    trend: Trend.UP,
    lastStudiedAt: daysAgo(1),
    masteryHistory: [72, 76, 79, 82],
    topics: [
      { name: "Reading Comprehension", mastery: 90, struggling: false },
      { name: "Phonics", mastery: 85, struggling: false },
      { name: "Creative Writing", mastery: 75, struggling: false },
      { name: "Spelling", mastery: 80, struggling: false },
    ],
  },
  {
    subject: "Mathematics",
    mastery: 70,
    coverage: 76,
    trend: Trend.UP,
    lastStudiedAt: daysAgo(2),
    masteryHistory: [60, 64, 67, 70],
    topics: [
      { name: "Addition & Subtraction", mastery: 95, struggling: false },
      { name: "Multiplication", mastery: 78, struggling: false },
      { name: "Division", mastery: 55, struggling: true },
      { name: "Fractions", mastery: 48, struggling: true },
    ],
  },
  {
    subject: "Science",
    mastery: 68,
    coverage: 74,
    trend: Trend.FLAT,
    lastStudiedAt: daysAgo(3),
    masteryHistory: [66, 67, 68, 68],
    topics: [
      { name: "Plants & Animals", mastery: 80, struggling: false },
      { name: "Weather", mastery: 72, struggling: false },
      { name: "Materials", mastery: 55, struggling: false },
      { name: "Forces", mastery: 48, struggling: true },
    ],
  },
  {
    subject: "Arabic",
    mastery: 62,
    coverage: 70,
    trend: Trend.UP,
    lastStudiedAt: daysAgo(4),
    masteryHistory: [50, 55, 58, 62],
    topics: [
      { name: "Reading", mastery: 70, struggling: false },
      { name: "Vocabulary", mastery: 65, struggling: false },
      { name: "Grammar", mastery: 50, struggling: true },
      { name: "Writing", mastery: 60, struggling: false },
    ],
  },
];

// ── Ahmed's Sessions ──────────────────────────────────────────────────────────

export const ahmedSessions = () => [
  { subject: "Mathematics", startedAt: hoursAgo(2),   durationMinutes: 35, topics: ["Algebra", "Quadratic Equations"],    score: 82 },
  { subject: "Science",     startedAt: daysAgo(1),    durationMinutes: 45, topics: ["Biology", "Cell Division"],          score: 70 },
  { subject: "English",     startedAt: daysAgo(5),    durationMinutes: 30, topics: ["Reading Comprehension"],             score: 88 },
  { subject: "Mathematics", startedAt: daysAgo(7),    durationMinutes: 40, topics: ["Statistics", "Probability"],         score: 75 },
  { subject: "Science",     startedAt: daysAgo(8),    durationMinutes: 25, topics: ["Chemistry Basics"],                  score: 60 },
  // Extra sessions so subjectProgress recent-sessions are representable
  { subject: "Mathematics", startedAt: daysAgo(3),    durationMinutes: 30, topics: ["Fractions", "Decimals"],             score: 68 },
  { subject: "Arabic",      startedAt: daysAgo(7),    durationMinutes: 20, topics: ["Reading", "Vocabulary"],             score: 55 },
];

// ── Layla's Sessions ──────────────────────────────────────────────────────────

export const laylaSessions = () => [
  { subject: "English",     startedAt: daysAgo(1),   durationMinutes: 40, topics: ["Creative Writing", "Story Structure"], score: 92 },
  { subject: "Mathematics", startedAt: daysAgo(5),   durationMinutes: 35, topics: ["Division", "Long Division"],           score: 78 },
  { subject: "Science",     startedAt: daysAgo(6),   durationMinutes: 25, topics: ["Plants & Animals"],                    score: 75 },
  { subject: "Arabic",      startedAt: daysAgo(7),   durationMinutes: 30, topics: ["Vocabulary", "Reading"],               score: 68 },
  { subject: "Mathematics", startedAt: daysAgo(12),  durationMinutes: 30, topics: ["Fractions"],                           score: 72 },
  { subject: "English",     startedAt: daysAgo(3),   durationMinutes: 30, topics: ["Phonics", "Spelling"],                 score: 85 },
];

// ── Ahmed's Homework ──────────────────────────────────────────────────────────
// "Homework due: 3 in next 48h" = items with deadline ≤ now+48h that are not completed/completed_late

export const ahmedHomework = () => [
  { subject: "Mathematics", topic: "Quadratic Equations",    deadline: daysFromNow(1), status: HomeworkStatus.IN_PROGRESS },
  { subject: "Science",     topic: "Cell Structure Essay",    deadline: daysFromNow(3), status: HomeworkStatus.PENDING },
  { subject: "English",     topic: "Book Report – Chapter 5", deadline: daysAgo(6),    status: HomeworkStatus.OVERDUE },
  { subject: "Arabic",      topic: "Dictation Practice",      deadline: daysAgo(12),   status: HomeworkStatus.COMPLETED_LATE },
  { subject: "Mathematics", topic: "Geometry Worksheet",      deadline: daysAgo(17),   status: HomeworkStatus.COMPLETED },
];

// ── Layla's Homework ──────────────────────────────────────────────────────────
// Ahmed: 1 item ≤ now+48h (IN_PROGRESS, due in 1d) = 1 from Ahmed
// + Layla: English IN_PROGRESS due in 2d + Arabic PENDING due in 1d = 2 from Layla
// Total = 3

export const laylaHomework = () => [
  { subject: "English",     topic: "Creative Writing – My Hero",   deadline: daysFromNow(2), status: HomeworkStatus.IN_PROGRESS },
  { subject: "Mathematics", topic: "Division Practice Sheet",       deadline: daysFromNow(4), status: HomeworkStatus.PENDING },
  { subject: "Arabic",      topic: "Vocabulary Quiz Prep",          deadline: daysFromNow(1), status: HomeworkStatus.PENDING },
  { subject: "Science",     topic: "Plants Observation Journal",    deadline: daysAgo(7),     status: HomeworkStatus.COMPLETED },
];

// ── Ahmed's Badges ────────────────────────────────────────────────────────────

export const AHMED_BADGES = [
  {
    key: "first-session",
    name: "First Session",
    emoji: "🎯",
    description: "Completed your very first learning session on Modrs.",
    criteria: "Complete 1 session",
    earned: true,
    earnedAt: new Date("2026-01-15"),
    progressCurrent: null as number | null,
    progressTotal: null as number | null,
    progressUnit: null as string | null,
  },
  {
    key: "7-day-streak",
    name: "7 Day Streak",
    emoji: "🔥",
    description: "Kept a learning streak for 7 consecutive days.",
    criteria: "7 consecutive days of learning",
    earned: true,
    earnedAt: new Date("2026-01-22"),
    progressCurrent: null,
    progressTotal: null,
    progressUnit: null,
  },
  {
    key: "math-master",
    name: "Math Master",
    emoji: "📐",
    description: "Mastered 10 mathematics topics.",
    criteria: "Master 10 Math topics",
    earned: true,
    earnedAt: new Date("2026-02-05"),
    progressCurrent: null,
    progressTotal: null,
    progressUnit: null,
  },
  {
    key: "reading-pro",
    name: "Reading Pro",
    emoji: "📚",
    description: "Read and completed 5 reading exercises.",
    criteria: "Complete 5 reading exercises",
    earned: true,
    earnedAt: new Date("2026-02-18"),
    progressCurrent: null,
    progressTotal: null,
    progressUnit: null,
  },
  {
    key: "science-star",
    name: "Science Star",
    emoji: "🔬",
    description: "Master 8 science topics to earn this badge.",
    criteria: "Master 8 Science topics",
    earned: false,
    earnedAt: null,
    progressCurrent: 5,
    progressTotal: 8,
    progressUnit: "topics",
  },
  {
    key: "perfect-week",
    name: "Perfect Week",
    emoji: "⭐",
    description: "Score 100% in all sessions for a full week.",
    criteria: "7 days of perfect scores",
    earned: false,
    earnedAt: null,
    progressCurrent: 3,
    progressTotal: 7,
    progressUnit: "days",
  },
  {
    key: "quick-learner",
    name: "Quick Learner",
    emoji: "⚡",
    description: "Complete 5 sessions in under 20 minutes each.",
    criteria: "5 fast sessions",
    earned: false,
    earnedAt: null,
    progressCurrent: 2,
    progressTotal: 5,
    progressUnit: "sessions",
  },
  {
    key: "champion",
    name: "Champion",
    emoji: "🏆",
    description: "Reach Level 15 to unlock the Champion badge.",
    criteria: "Reach Level 15",
    earned: false,
    earnedAt: null,
    progressCurrent: 12,
    progressTotal: 15,
    progressUnit: "levels",
  },
];

// ── Layla's Badges ────────────────────────────────────────────────────────────

export const LAYLA_BADGES = [
  {
    key: "first-session",
    name: "First Session",
    emoji: "🎯",
    description: "Completed your very first learning session on Modrs.",
    criteria: "Complete 1 session",
    earned: true,
    earnedAt: new Date("2026-03-10"),
    progressCurrent: null as number | null,
    progressTotal: null as number | null,
    progressUnit: null as string | null,
  },
  {
    key: "7-day-streak",
    name: "7 Day Streak",
    emoji: "🔥",
    description: "Kept a learning streak for 7 consecutive days.",
    criteria: "7 consecutive days of learning",
    earned: true,
    earnedAt: new Date("2026-03-20"),
    progressCurrent: null,
    progressTotal: null,
    progressUnit: null,
  },
  {
    key: "reading-star",
    name: "Reading Star",
    emoji: "📚",
    description: "Read and completed 5 reading exercises.",
    criteria: "Complete 5 reading exercises",
    earned: true,
    earnedAt: new Date("2026-04-03"),
    progressCurrent: null,
    progressTotal: null,
    progressUnit: null,
  },
  {
    key: "math-explorer",
    name: "Math Explorer",
    emoji: "📐",
    description: "Master 6 math topics to earn this badge.",
    criteria: "Master 6 Math topics",
    earned: false,
    earnedAt: null,
    progressCurrent: 4,
    progressTotal: 6,
    progressUnit: "topics",
  },
  {
    key: "science-star",
    name: "Science Star",
    emoji: "🔬",
    description: "Master 8 science topics to earn this badge.",
    criteria: "Master 8 Science topics",
    earned: false,
    earnedAt: null,
    progressCurrent: 1,
    progressTotal: 8,
    progressUnit: "topics",
  },
  {
    key: "perfect-week",
    name: "Perfect Week",
    emoji: "⭐",
    description: "Score 100% in all sessions for a full week.",
    criteria: "7 days of perfect scores",
    earned: false,
    earnedAt: null,
    progressCurrent: 1,
    progressTotal: 7,
    progressUnit: "days",
  },
  {
    key: "quick-learner",
    name: "Quick Learner",
    emoji: "⚡",
    description: "Complete 5 sessions in under 20 minutes each.",
    criteria: "5 fast sessions",
    earned: false,
    earnedAt: null,
    progressCurrent: 0,
    progressTotal: 5,
    progressUnit: "sessions",
  },
  {
    key: "champion",
    name: "Champion",
    emoji: "🏆",
    description: "Reach Level 15 to unlock the Champion badge.",
    criteria: "Reach Level 15",
    earned: false,
    earnedAt: null,
    progressCurrent: 8,
    progressTotal: 15,
    progressUnit: "levels",
  },
];

// ── Reminder configs (Reminders.tsx REMINDERS) ────────────────────────────────

export const REMINDER_CONFIGS: Array<{
  type: ReminderType;
  enabled: boolean;
  recipient: ReminderRecipient;
  settings: Record<string, unknown> | null;
}> = [
  { type: ReminderType.DAILY_STUDY,       enabled: true,  recipient: ReminderRecipient.CHILD,  settings: { time: "17:00", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] } },
  { type: ReminderType.HOMEWORK_DUE,      enabled: true,  recipient: ReminderRecipient.BOTH,   settings: { leadTimeHours: 24 } },
  { type: ReminderType.STREAK_PROTECTION, enabled: true,  recipient: ReminderRecipient.CHILD,  settings: null },
  { type: ReminderType.MISSED_SESSION,    enabled: false, recipient: ReminderRecipient.PARENT, settings: null },
  { type: ReminderType.WEEKLY_SUMMARY,    enabled: true,  recipient: ReminderRecipient.PARENT, settings: { channel: "email" } },
  { type: ReminderType.STRUGGLE_ALERT,    enabled: true,  recipient: ReminderRecipient.PARENT, settings: null },
  { type: ReminderType.EXAM_COUNTDOWN,    enabled: false, recipient: ReminderRecipient.BOTH,   settings: null },
  { type: ReminderType.ACHIEVEMENT,       enabled: true,  recipient: ReminderRecipient.BOTH,   settings: null },
  { type: ReminderType.REWARD_REDEEMED,   enabled: true,  recipient: ReminderRecipient.PARENT, settings: null },
];

// ── 5 Unread Notifications (Home.tsx → "5 Unread alerts") ────────────────────

export const notificationsData = () => [
  { recipient: NotificationRecipient.PARENT, title: "Ahmed completed Math homework", body: "Quadratic Equations assignment is done.", readAt: null },
  { recipient: NotificationRecipient.PARENT, title: "Layla has a struggle alert", body: "Layla is struggling with Division topics.", readAt: null },
  { recipient: NotificationRecipient.PARENT, title: "Ahmed earned a new badge", body: "Ahmed unlocked the 7 Day Streak badge.", readAt: null },
  { recipient: NotificationRecipient.PARENT, title: "Weekly progress summary ready", body: "Your weekly report is now available.", readAt: null },
  { recipient: NotificationRecipient.PARENT, title: "Subscription renewal reminder", body: "Your Family plan renews on June 15, 2027.", readAt: null },
];
