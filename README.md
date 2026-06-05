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

# 3. Generate Prisma client
npx prisma generate

# 4. Start with hot reload
npm run dev
```

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
