import { config as loadDotenv } from "dotenv";
import { z } from "zod";

if (process.env["NODE_ENV"] !== "production") {
  loadDotenv();
}

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgres"),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) =>
      val
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Auth — JWT
  JWT_ACCESS_SECRET: z.string().min(32).default("change-me-access-secret-at-least-32-chars!!"),
  JWT_REFRESH_SECRET: z.string().min(32).default("change-me-refresh-secret-at-least-32-chars!"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // Auth — Lockout
  AUTH_LOCK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_WINDOW: z.string().default("15m"),

  // Auth — Re-auth (shared device)
  REAUTH_WINDOW: z.string().default("15m"),
  // When Redis is unavailable, whether the shared-device re-auth gate lets requests
  // through (true) or rejects them (false). Defaults to fail-closed.
  REAUTH_FAIL_OPEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Object storage (login-card images) — local-filesystem dev stub now, R2/S3 in Phase 7
  STORAGE_DIR: z.string().default("./storage"),
  STORAGE_PUBLIC_URL: z.string().default("http://localhost:4000/storage"),

  // Mailer
  MAILER_TRANSPORT: z.enum(["stub", "smtp"]).default("stub"),
  MAILER_FROM: z.string().email().default("noreply@example.com"),
  MAILER_SMTP_HOST: z.string().optional(),
  MAILER_SMTP_PORT: z.coerce.number().int().optional(),
  MAILER_SMTP_USER: z.string().optional(),
  MAILER_SMTP_PASS: z.string().optional(),

  // OAuth — Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // OAuth — Apple
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.string().url().optional(),

  // Phase 5 — Payment & subscription (research.md §8, quickstart.md §1)
  // The provider behind the PaymentProvider interface. Dev/test fall back to the
  // in-memory fake when the secret keys are absent.
  PAYMENT_PROVIDER: z.enum(["moyasar", "fake"]).default("moyasar"),
  // Provider REST secret key — optional in dev so the in-memory fake works without it.
  PAYMENT_PROVIDER_SECRET_KEY: z.string().optional(),
  // HMAC secret the webhook verifies the raw body against — optional in dev (the fake
  // signs deterministically). Required in production by the guard below.
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  // Per-extra-child overflow price in minor units (SAR 25 = 2500 halalas).
  OVERFLOW_PRICE_MINOR: z.coerce.number().int().positive().default(2500),

  // Phase 6 — Background jobs & notifications (plan.md, quickstart.md §1)
  // BullMQ worker concurrency per queue.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // Repeatable-job cron expressions for the sweeps (BullMQ `repeat.pattern`).
  REMINDERS_SWEEP_CRON: z.string().default("*/15 * * * *"),
  PURGE_SWEEP_CRON: z.string().default("0 * * * *"),
  // Fixed platform day-boundary offset in minutes (Asia/Riyadh = UTC+3, no DST = 180).
  PLATFORM_TZ_OFFSET_MINUTES: z.coerce.number().int().default(180),
  // The central daily notification cap per child (FR-007).
  DAILY_NOTIFICATION_CAP: z.coerce.number().int().positive().default(3),
  // Struggle detection: consecutive below-threshold sessions on a topic that raise an alert.
  STRUGGLE_CONSECUTIVE_THRESHOLD: z.coerce.number().int().positive().default(3),
  // Mastery percentage (0–100) below which a session counts as "low mastery".
  STRUGGLE_MASTERY_THRESHOLD: z.coerce.number().int().min(0).max(100).default(50),
  // Push channel provider. The dev stub logs (mirrors the mailer/payments stubs).
  PUSH_PROVIDER: z.enum(["stub", "fcm"]).default("stub"),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CREDENTIALS_JSON: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid configuration:\n${issues}`);
}

// In production, refuse to boot with the known-weak development secret defaults.
if (parsed.data.NODE_ENV === "production") {
  const secrets: Array<[string, string]> = [
    ["JWT_ACCESS_SECRET", parsed.data.JWT_ACCESS_SECRET],
    ["JWT_REFRESH_SECRET", parsed.data.JWT_REFRESH_SECRET],
  ];
  const weak = secrets.filter(([, value]) => value.startsWith("change-me-"));
  if (weak.length) {
    throw new Error(
      `Refusing to start in production with default secrets: ${weak
        .map(([name]) => name)
        .join(", ")}`,
    );
  }

  // The in-memory fake provider is a test/dev affordance only. In production the
  // real provider secrets must be present so payments can never silently run
  // against the fake (research.md §8).
  if (parsed.data.PAYMENT_PROVIDER !== "fake") {
    const missing = (["PAYMENT_PROVIDER_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET"] as const).filter(
      (key) => !parsed.data[key],
    );
    if (missing.length) {
      throw new Error(
        `Refusing to start in production without payment secrets: ${missing.join(", ")}`,
      );
    }
  }

  // The push stub only logs. In production with the real FCM provider selected, the
  // FCM credentials must be present so notifications can never silently no-op.
  if (parsed.data.PUSH_PROVIDER === "fcm") {
    const missingPush = (["FCM_PROJECT_ID", "FCM_CREDENTIALS_JSON"] as const).filter(
      (key) => !parsed.data[key],
    );
    if (missingPush.length) {
      throw new Error(
        `Refusing to start in production without FCM credentials: ${missingPush.join(", ")}`,
      );
    }
  }
}

const config = Object.freeze(parsed.data);

export default config;
export type Config = typeof config;
