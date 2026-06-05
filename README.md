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
