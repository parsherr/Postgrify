# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Philosophy

These are non-negotiable standards for every change made to this codebase.

**Write for the next developer, not just the compiler.**
Every file, function, and variable should be immediately understandable to someone who has never seen it before. If you need a comment to explain *what* code does, rewrite the code. Comments explain *why*, not *what*.

**Think in years, not sprints.**
Before adding any abstraction, dependency, or architectural pattern, ask: "Will this still make sense in 2 years when the codebase is 5× larger?" Prefer boring, explicit code over clever, concise code. A future maintainer will thank you for the extra 3 lines of clarity.

**Specific rules:**
- Functions do one thing. If you need "and" to describe a function, split it.
- No magic numbers or strings — extract named constants.
- Fail loudly and early with descriptive errors. Silent failures and empty catch blocks are forbidden except where explicitly documented with a reason.
- Keep files under ~300 lines. A file that does too many things should be split along its natural seams.
- Side effects belong at the edges (route handlers, service entry points), not buried in utilities.
- Every new route, service, or hook must have the same level of structure and documentation as the files around it — no drive-by additions.

## Project Overview

Postgrify is a multi-database PostgreSQL gateway: a single REST API that manages multiple PostgreSQL databases, each with its own lazy connection pool. Includes a React GUI for table/schema/SQL management, and a zero-dependency auth SDK.

Monorepo structure:
- `packages/api/` — Fastify + TypeScript REST API
- `packages/gui/` — React + Vite + Tailwind CSS frontend
- `packages/auth-js/` — `@postgrify/auth-js` SDK (zero-dep, browser + Node)
- `packages/docker-compose.yml` — canonical way to run everything

## Commands

> **Working directory:** The primary working directory for Claude Code sessions is `packages/gui/`. Commands below assume you're in the relevant package directory unless noted. The repo root contains `docker-compose.prod.yml`, `plan.md`, and `docs/`.

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
npm run test:coverage # vitest run --coverage

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

### auth-js SDK
```bash
cd packages/auth-js
npm install
npm run build   # tsup → dist/ (ESM + CJS + .d.ts)
npm run typecheck
```

## Architecture

### API request lifecycle
1. `src/index.ts` — creates Fastify, calls `registerPlugins` then `registerRoutes`
2. **Plugins** (order matters): `cors → rateLimit → auth → cache → pool → openApi`
3. **Routes**: `/health`, `/auth/*`, `/admin/*`, `/db/:db/*`

### Route map
| Group | Prefix | Files |
|-------|--------|-------|
| Health | `/health` | `routes/health.ts` |
| Setup | `/setup` | `routes/setup.ts` — first-run admin account creation; becomes no-op once setup is done |
| Admin auth | `/auth` | `routes/auth/{token,adminToken,adminLogin,logout,refresh,me,sessions}.ts` |
| Admin DB mgmt | `/admin` | `routes/admin/{databases,stats}.ts` |
| DB data | `/db/:database` | `routes/db/{tables,rows,query,meta,backup}.ts` — requires `authenticate` + `dbResolver` |
| DB auth | `/db/:database/auth` | `routes/db/auth/` — see Per-DB Auth section below |
| Terminal | `/terminal` | `routes/terminal.ts` — WebSocket shell via `node-pty`; requires admin token |

All `/db/:database/*` data routes run `authenticate` → `dbResolver` as Fastify hooks at group level.
DB auth routes skip the group-level `authenticate` — login/logout/refresh are public and rate-limited; admin-gated routes add `authenticate` + `scopeGuard("schema")` per-handler.

### Auth model
Two token types, both JWT signed with `JWT_SECRET`:
- **DB token** — scoped (`read`/`write`/`delete`/`schema`/`query`), tied to one database. Obtained via `POST /auth/token` with a per-DB secret (falls back to `ADMIN_SECRET`).
- **Admin token** — full access. Obtained via `POST /auth/token/admin` with `ADMIN_SECRET`.
- **DB user token** — issued to per-DB app users; carries `iss: "postgrify/db-auth"`. `jwtService.verifyAdminOrDb()` rejects these; `jwtService.verifyDbUser()` requires them.

`plugins/auth.ts` exposes `server.jwtService` (decorator) and `server.authenticate` / `server.authenticateAdmin` (preHandlers).

Per-DB secrets override `ADMIN_SECRET` for token issuance: set `DB_SECRET_<DBNAME>=<secret>` in the environment.

### Middleware
`middleware/dbResolver.ts` — resolves `req.dbName` from URL param `/db/:database`, `X-Database` header, or `?database=` query param.

`middleware/scopeGuard.ts` — factory: `preHandler: [server.authenticate, scopeGuard("write")]`. Admin tokens bypass scope checks; DB tokens are checked against `req.dbName` to prevent cross-database access.

### Connection pool model
`services/poolManager.ts` wraps `postgres` (postgres.js). Pools are created lazily on first `getPool(dbName)` call and evicted after idle timeout. Available on routes as `server.poolManager`.

### Cache model
`services/cacheService.ts` uses Redis if `REDIS_URL` is set, otherwise falls back to an in-memory LRU cache. `@fastify/rate-limit` requires `ioredis`; the project uses `node-redis` v4, so the Redis store for rate-limiting is intentionally disabled in `plugins/rateLimit.ts`.

### Query builder
`services/queryBuilder.ts` converts HTTP query parameters into safe parameterized SQL. Filter syntax: `where=field.op.value`. Supported operators: `eq neq gt gte lt lte like ilike in is not`. All column names are validated with `isValidIdentifier` before use.

### Per-database auth system

Each managed database has an isolated `_postgrify_auth` schema provisioned lazily via `routes/db/auth/provision.ts`. The schema is invisible in the Tables tab. Tables: `users`, `sessions`, `audit_log`, `oauth_providers`, `auth_settings`.

**Auth route files** (all under `routes/db/auth/`):

| File | Endpoints |
|------|-----------|
| `tokens.ts` | `POST /login`, `POST /logout`, `POST /refresh` |
| `signup.ts` | `POST /signup` — creates user, sends verify email |
| `verify.ts` | `GET /verify?token=` — email verification |
| `me.ts` | `GET /me` — current user profile (DB user JWT required) |
| `passwordReset.ts` | `POST /password/forgot`, `POST /password/reset` |
| `magicLink.ts` | `POST /magic-link`, `GET /magic-link/verify?token=` |
| `oauth.ts` | `GET /oauth/:provider`, `GET /oauth/:provider/callback` |
| `users.ts` | User CRUD + `PATCH /me/password` (schema scope) |
| `settings.ts` | `GET/PUT /settings`, `GET/POST/DELETE /settings/oauth/:provider` (schema scope) |
| `audit.ts` | `GET /audit` — paginated log (schema scope) |
| `sessions.ts` | `GET /sessions`, `DELETE /sessions/:id`, `DELETE /sessions?user_id=` (schema scope) |

`provision.ts` also exports `insertAuditLog()` and `getAuthSetting()` — used by all auth handlers to record events and read feature flags.

`services/emailService.ts` — nodemailer wrapper. Falls back to `console.log` when `SMTP_HOST` is unset (dev mode). Templates: `buildVerifyEmail`, `buildPasswordResetEmail`, `buildMagicLinkEmail`.

`services/oauthService.ts` — Google and GitHub authorization code flow (`getAuthUrl`, `exchangeCode`).

### Settings service
`services/settingsService.ts` persists admin configuration to a `_postgrify_settings` table in the primary PostgreSQL database. Stores `autoStartDatabases`. Exposed via `GET/POST /admin/settings`.

### Identifier and DDL safety
All table/column/DB names pass through `utils/identifier.ts` before SQL interpolation. Regex: `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/` plus reserved-keyword blocklist. Never skip this for user-supplied identifiers.

`utils/ddlSanitizer.ts` strips dangerous DDL from SQL in read-only query contexts.

`utils/asyncHandler.ts` wraps async handlers to forward errors to Fastify's error handler.

### GUI structure
- `lib/api.ts` — all HTTP calls; reads `VITE_API_URL` at build time (default `http://localhost:3000`). Exposes `setTokenAccessors()` for AuthContext injection. Admin refresh token in `localStorage` under `postgrify_refresh_token`.
- `hooks/` — React Query wrappers: `useDatabases`, `useTables`, `useRows`, `useDbAuth` (per-DB users), `useAuthSettings`, `useAuditLog`, `useAuthSessions`
- `pages/` — `LoginPage`, `DashboardPage`, `DatabasesPage`, `DatabasePage`, `TablePage`, `CreateTablePage`, `QueryPage`, `ApiKeysPage`. All protected pages wrap `ProtectedLayout` from `App.tsx`.
- `components/database/AuthsTab.tsx` — 4-tab per-DB auth panel: Kullanıcılar / Ayarlar / Audit Log / Session'lar
- Auth state stored in memory via `AuthContext`; admin refresh token in localStorage.

### @postgrify/auth-js SDK
Zero-dependency Supabase-like client for per-DB app auth:
```typescript
import { createClient } from '@postgrify/auth-js'
const auth = createClient({ url, database })
await auth.signUp({ email, password })
await auth.signIn({ email, password })
auth.signInWithOAuth({ provider: 'google' })
auth.onAuthStateChange((event, session) => { ... })
```
Internals: `client.ts` (main class + `createClient` factory), `session.ts` (SessionManager, auto-refresh timer), `storage.ts` (localStorage/sessionStorage/memory adapters), `types.ts`.

### First-run setup
`routes/setup.ts` handles `POST /setup` — creates the initial admin account. Returns 409 if admin already exists. `LoginPage` detects this and redirects to setup flow.

### Test setup
Tests use Vitest. `test/setup.ts` overrides all env vars (`NODE_ENV=test`, `LOG_LEVEL=silent`) before any test file runs. Tests do **not** require a running database — they mock at the service layer.

Test files under `packages/api/test/` mirror `src/` layout. `packages/test/` at monorepo level is reserved for future integration tests.

## Environment variables

`packages/.env` is required for Docker Compose. `packages/.env.example` is the template. `exampleenv.md` at repo root has annotated explanations. Mandatory: `PG_PASSWORD`, `JWT_SECRET` (≥32 chars), `ADMIN_SECRET` (≥16 chars).

Optional for auth features:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` — email sending
- `APP_URL` — base URL for email links (default `http://localhost:5173`)

**Docker Compose setup:** `PG_HOST=host.docker.internal` — API container connects to host PostgreSQL. `REDIS_URL=redis://redis:6379`. No `postgres` service in docker-compose.yml; host's PostgreSQL is used directly.

Per-DB secrets: `DB_SECRET_<DBNAME>=<secret>` (e.g. `DB_SECRET_PROJECT1=my-secret`).

## Port map (Docker)

| Service  | Host port | Notes |
|----------|-----------|-------|
| GUI      | 5173      | nginx serving React build; proxies `/api/*` → API |
| API      | 3000      | Fastify |
| Redis    | 6379      | |
| PostgreSQL | 5432    | **Host machine's PostgreSQL** — not a Docker container |

GUI's nginx proxies `/api/` to `http://api:3000/` so `VITE_API_URL=/api` works regardless of host IP.

### Host PostgreSQL prerequisites
- `postgresql.conf`: `listen_addresses = '*'`
- `pg_hba.conf`: `host all all 172.16.0.0/12 scram-sha-256`