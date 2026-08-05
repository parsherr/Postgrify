# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Postgrify is a multi-database PostgreSQL gateway: a single REST API that manages multiple PostgreSQL databases, each with its own lazy connection pool. Includes a React GUI for table/schema/SQL management.

Monorepo structure:
- `packages/api/` — Fastify + TypeScript REST API
- `packages/gui/` — React + Vite + Tailwind CSS frontend
- `packages/docker-compose.yml` — canonical way to run everything

## Commands

### Docker (recommended — runs full stack)
```bash
cd packages
docker compose up -d --build      # build + start all services
docker compose down               # stop (add -v to also remove volumes)
docker compose up -d api --build  # rebuild only the API
docker logs packages-api-1 -f     # follow API logs
```

### API (local dev)
```bash
cd packages/api
npm install
npm run dev          # tsx watch (hot reload)
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode

# Run a single test file:
npx vitest run test/routes/tables.test.ts
```

### GUI (local dev)
```bash
cd packages/gui
npm install
npm run dev     # Vite dev server → http://localhost:5173
npm run build   # production build → dist/
```

## Architecture

### API request lifecycle
1. `src/index.ts` — creates Fastify, calls `registerPlugins` then `registerRoutes`
2. **Plugins** (order matters): `cors → rateLimit → auth → cache → pool → openApi`
3. **Routes**: `/health`, `/auth/*`, `/admin/*`, `/db/:db/*`

### Auth model
Two token types, both JWT signed with `JWT_SECRET`:
- **DB token** — scoped (`read`/`write`/`delete`/`schema`/`query`), tied to one database. Obtained via `POST /auth/token` with a per-DB secret (falls back to `ADMIN_SECRET`).
- **Admin token** — full access. Obtained via `POST /auth/token/admin` with `ADMIN_SECRET`.

Fastify decorators `server.authenticate` and `server.authenticateAdmin` are added by `plugins/auth.ts` and used as `preHandler` hooks on individual routes.

Per-DB secrets override `ADMIN_SECRET` for token issuance: set `DB_SECRET_<DBNAME>=<secret>` in the environment (e.g. `DB_SECRET_PROJECT1=my-secret`).

### Middleware
`middleware/dbResolver.ts` — resolves `req.dbName` from (in priority order) URL param `/db/:database`, `X-Database` header, or `?database=` query param. Applied as a `preHandler` on all `/db/:db/*` routes.

`middleware/scopeGuard.ts` — factory that returns a Fastify `preHandler`. Usage: `preHandler: [server.authenticate, scopeGuard("write")]`. Admin tokens bypass scope checks; DB tokens are also checked against `req.dbName` to prevent cross-database access.

### Connection pool model
`services/poolManager.ts` wraps `postgres` (postgres.js). Pools are created lazily on first `getPool(dbName)` call, and evicted after idle timeout. The `PoolManager` instance is available on all routes as `server.poolManager`.

### Cache model
`services/cacheService.ts` uses Redis if `REDIS_URL` is set, otherwise falls back to an in-memory LRU cache. Available on routes as `server.cache`.

**Important:** `@fastify/rate-limit` requires `ioredis`; the project uses `node-redis` v4. The Redis store for rate-limiting is intentionally disabled in `plugins/rateLimit.ts` — rate limiting runs in-memory.

### Query builder
`services/queryBuilder.ts` converts HTTP query parameters into safe parameterized SQL. Filter syntax: `where=field.op.value` (e.g. `where=age.gt.18&where=status.eq.active`). Supported operators: `eq neq gt gte lt lte like ilike in is not`. Order syntax: `order=field.asc` or `order=field.desc`. Select syntax: `select=id,name,email` (comma-separated column names or `*`). All column names are validated with `isValidIdentifier` before use.

### Identifier safety
All table/column/DB names pass through `utils/identifier.ts` before being interpolated into SQL. The regex is `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/` plus a reserved-keyword blocklist. Never skip this when adding new routes that accept user-supplied identifiers.

`utils/asyncHandler.ts` wraps async route handlers to forward thrown errors to Fastify's error handler (avoids unhandled promise rejections in route callbacks).

### GUI structure
- `lib/api.ts` — all HTTP calls; reads `VITE_API_URL` at build time (default `http://localhost:3000`)
- `hooks/` — React Query wrappers (`useAuth`, `useDatabases`, `useTables`, `useRows`, `useDbSize`)
- `pages/` — one file per route; all protected pages use `ProtectedLayout` from `App.tsx`
- Auth state is stored in `localStorage` under the key `postgrify_token`

### Test setup
Tests use Vitest. `test/setup.ts` overrides all env vars (including `NODE_ENV=test`, `LOG_LEVEL=silent`) before any test file runs. Tests do **not** require a running database — they mock at the service layer.

## Environment variables

`packages/.env` is required to run via Docker Compose. `packages/.env.example` is the template — copy and fill in secrets. Mandatory: `PG_PASSWORD`, `JWT_SECRET` (≥32 chars), `ADMIN_SECRET` (≥16 chars).

**Docker Compose setup:** `PG_HOST=host.docker.internal` — the API container connects to the host machine's PostgreSQL (not a Docker-managed postgres container). `REDIS_URL=redis://redis:6379` (the Redis service name). There is no `postgres` service in docker-compose.yml; the host's PostgreSQL is used directly so data is never tied to Docker volumes.

Per-DB secrets override `ADMIN_SECRET` for token issuance: set `DB_SECRET_<DBNAME>=<secret>` in the environment (e.g. `DB_SECRET_PROJECT1=my-secret`).

## Port map (Docker)

| Service  | Host port | Notes |
|----------|-----------|-------|
| GUI      | 5173      | nginx serving React build; proxies `/api/*` → API |
| API      | 3000      | Fastify |
| Redis    | 6379      | |
| PostgreSQL | 5432    | **Host machine's PostgreSQL** — not a Docker container |

GUI's nginx proxies `/api/` to `http://api:3000/` so `VITE_API_URL=/api` works regardless of the host IP. No `localhost:3000` hardcoded in the browser.

### Host PostgreSQL prerequisites
The host's PostgreSQL must accept connections from Docker's network range:
- `postgresql.conf`: `listen_addresses = '*'`
- `pg_hba.conf`: `host all all 172.16.0.0/12 scram-sha-256`