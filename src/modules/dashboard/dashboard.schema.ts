import { z } from "zod";

// ── Inbound validation ────────────────────────────────────────────────────────
// The only inbound input this phase is the :childId path param (Principle III).

export const childIdParamSchema = z.object({
  childId: z.string().min(1),
});

export type ChildIdParam = z.infer<typeof childIdParamSchema>;

// ── Response types (match contracts/dashboard.openapi.yaml + the FE mock shapes) ─

export interface LastSession {
  subject: string;
  when: string; // server-formatted relative time, e.g. "2 hours ago"
}

export interface HomeworkCounts {
  pending: number;
  completed: number;
  overdue: number;
}

export interface ChildOverview {
  id: string;
  name: string;
  grade: string;
  minutesThisWeek: number;
  sessions: number;
  streak: number;
  topSubject: string | null;
  lastSession: LastSession | null;
  homework: HomeworkCounts;
  hasStruggleAlert: boolean;
  status: "active" | "paused";
}

export interface ChildListItem extends ChildOverview {
  displayName: string;
  age: number;
  username: string;
}

export interface HomeStats {
  minutesThisWeek: number;
  mostActive: { name: string | null; streakDays: number };
  homeworkDueSoon: number;
  unreadNotifications: number;
}

export interface HomeSummary {
  stats: HomeStats;
  children: ChildOverview[];
}

export interface SubjectTopic {
  name: string;
  mastery: number;
  struggling: boolean;
}

export interface SubjectRecentSession {
  date: string; // relative, e.g. "Today" / "Yesterday" / "3 days ago"
  duration: string; // e.g. "35 min"
  score?: number;
}

export interface SubjectProgress {
  subject: string;
  mastery: number;
  coverage: number;
  trend: "up" | "down" | "flat";
  lastStudied: string | null;
  masteryHistory: number[];
  topics: SubjectTopic[];
  recentSessions: SubjectRecentSession[];
}

export interface HomeworkItem {
  id: string;
  subject: string;
  topic: string;
  deadline: string; // display date, e.g. "Tomorrow" / "Jun 6"
  status: "pending" | "in_progress" | "completed" | "overdue" | "completed_late";
  daysInfo: string;
}

export interface SessionItem {
  id: string;
  date: string; // relative date+time, e.g. "Today, 3:00 PM"
  subject: string;
  duration: string;
  topics: string[];
  score?: number;
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  criteria: string;
  earned: boolean;
  date?: string; // present only if earned
  progress?: { current: number; total: number; unit: string }; // present only if not earned
}

export interface ChildProfile {
  id: string;
  name: string;
  displayName: string;
  grade: string;
  age: number;
  status: "active" | "paused";
  dob: string;
  gender: string;
  country: string;
  curriculum: string;
  subjects: string[];
  username: string;
  minutesThisWeek: number;
  sessionsThisWeek: number;
  streak: number;
  totalXP: number;
  totalMinutes: number;
  badgesThisMonth: number;
  masteryPercentage: number;
  coveragePercentage: number;
  trendVsLastWeek: number;
  bedtimeCutoff: string | null;
  allowedDays: string[];
  blockedSubjects: string[];
  level: number;
  levelXp: number;
  levelMax: number;
  nextLevel: number;
  streakTokens: number;
  subjectProgress: SubjectProgress[];
  homework: HomeworkItem[];
  sessions: SessionItem[];
  badges: Badge[];
}

export interface ReminderEntry {
  id: string;
  type: string;
  recipient: "Child" | "Parent" | "Both";
  description: string;
  enabled: boolean;
  hasSettings: boolean;
  settings?: Record<string, unknown>;
}

export interface SettingsPayload {
  account: {
    fullName: string;
    email: string;
    phone: string | null;
    country: string | null;
    language: string;
  };
  notificationPrefs: {
    push: boolean;
    email: boolean;
    whatsapp: boolean;
  };
  subscription: {
    planName: string;
    childLimit: number;
    childrenUsed: number;
    priceLabel: string;
    currency: string;
    billingCycle: "monthly" | "yearly";
    renewalDate: string;
    status: string;
  };
}
