# modars-parent-back

Modrs.ai backend — Express + TypeScript service (Phase 0 foundations).

## Prerequisites

- Node.js 20 LTS + npm
- PostgreSQL (local Docker or managed)
- Redis (provisioned for later phases; optional for Phase 0 health check)
- Docker (container path only)

## Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, REDIS_URL (and optionally PORT, CORS_ORIGINS, etc.)

# 3. Apply migrations + seed the database
npm run db:migrate          # apply schema migrations
npm run db:seed             # load the Sarah Ahmed mock-parity fixture

# 4. Start with hot reload
npm run dev
```

## Database scripts (Phase 1)

| Script | Description |
|--------|-------------|
| `npm run db:migrate` | Apply pending Prisma migrations to the database (`prisma migrate dev`) |
| `npm run db:seed` | Load the mock-parity fixture (Sarah Ahmed family) via `prisma db seed` |
| `npm run db:reset` | Drop all tables, re-apply migrations, re-seed (`prisma migrate reset --force`) |
| `npm run db:studio` | Open Prisma Studio to browse/edit rows visually |

### From scratch (CI / clean slate)

```bash
npm run db:reset    # drop → migrate → seed in one command
```

### Verify seed parity

```bash
# Automated parity assertions
npm test -- seed-parity

# Visual inspection
npm run db:studio
```

After seeding you should see:
- `Parent` Sarah Ahmed (OWNER) in one `Family` with two `Child` rows
- `Child` Ahmed: `minutesThisWeek=240`, `streak=12`, `topSubject=Mathematics`
- `Child` Layla: `minutesThisWeek=180`, `streak=8`, `topSubject=English`
- `Subscription` FAMILY / ACTIVE / YEARLY, renews 2027-06-15; two PAID invoices of 149900 SAR-minor
- Each child has 9 `ReminderConfig` rows and 8 `Badge` rows
- 5 `Notification` rows with `readAt = null`

## Build

```bash
npm run build        # Compiles TypeScript → dist/
npm start            # Runs dist/server.js
```

## Testing

```bash
npm test             # Run all tests (vitest + supertest)
npm run test:watch   # Watch mode
```

## Linting & Formatting

```bash
npm run lint         # ESLint
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check
```

## Container

```bash
# Build
docker build -t modars-back:dev .

# Run (copy .env.example values, fill DATABASE_URL and REDIS_URL)
docker run --rm -p 4000:4000 --env-file .env modars-back:dev

# Verify
curl -i http://localhost:4000/health
```

## Health endpoint

```
GET /health
```

- `200` — service healthy, database reachable
- `503` — database unreachable (`status: "degraded"`)

Redis being down alone does **not** cause a 503.

## Environment variables

See `.env.example` for all required and optional keys with descriptions.

## Background jobs & notifications worker (Phase 6)

Phase 6 adds a durable **BullMQ + Redis** worker substrate. The web process
(`npm run dev` / `server.ts`) only **enqueues**; a separate **worker process**
runs the jobs:

```bash
npm run worker        # boots all BullMQ workers + the repeatable schedulers
```

### Queues

| Queue | Trigger | What it does |
|-------|---------|--------------|
| `session-events` | enqueued by the AI-pipeline producer | validates the locked session event, dedupes on `eventId`, drives homework transitions + progress/XP/streak + struggle detection (one transaction, exactly-once) |
| `notifications` | enqueued by the central dispatcher | delivers one notification on one channel (push/email); retries with backoff; dead-letters on exhaustion |
| `reminders-sweep` | repeatable (every 15 min) | evaluates each child's reminders, applies the central **max-3/child/day** cap, runs the time-driven homework `OVERDUE` transition, and dispatches renewal/dunning billing notices |
| `child-purge` | repeatable (hourly) | permanently removes children 7 days after soft-delete, releasing the username |
| `subscription-purge` | repeatable (hourly) | permanently removes canceled subscriptions past their retain deadline |

All workers call **services** (never Prisma directly), resolve `familyId` from the
record they process, and apply state-mutating effects **idempotently**. Exhausted
jobs are retained (not dropped) and logged via pino. The single central dispatcher
(`modules/notifications`) is the **only** place the daily cap and per-type priority
tier are enforced.

### Phase 6 environment keys

`WORKER_CONCURRENCY`, `REMINDERS_SWEEP_CRON`, `PURGE_SWEEP_CRON`,
`PLATFORM_TZ_OFFSET_MINUTES` (Asia/Riyadh day boundary, default 180),
`DAILY_NOTIFICATION_CAP` (default 3), `STRUGGLE_CONSECUTIVE_THRESHOLD` (default 3),
`STRUGGLE_MASTERY_THRESHOLD` (default 50), `PUSH_PROVIDER` (`stub` | `fcm`),
`FCM_PROJECT_ID`, `FCM_CREDENTIALS_JSON`. See `.env.example` for defaults.

### Push-token registration (the only new HTTP surface)

```
POST   /notifications/push-tokens   { platform: "FCM"|"APNS", token }   (auth-gated)
DELETE /notifications/push-tokens?token=...                              (auth-gated)
```

Family/owner are taken from the verified session, never the body. Both parent and
child sessions may register a device token.
