# Changelog

All notable changes to Postgrify are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [0.3.21] - 2026-08-17

### Changed
- Translated all Turkish text to English across the entire codebase
- GUI: all UI labels, button text, tab names, placeholders, error messages, toast notifications, aria-labels
- API src: all JSDoc comments and inline comments in config, middleware, plugins, routes, services, utils
- API tests: all describe/it strings, inline comments across routes, middleware, plugins, security test suites
- tweeter-clone demo app: all UI strings, placeholders, error messages, locale settings (tr-TR → en-US)
- Relative time strings in lib/utils.ts (az önce → just now, etc.)

---

## [0.3.2] — 2026-08-16

### Added — PostgREST / Supabase Compatibility

- **C-01 — GET list response** — body is now a flat JSON array (breaking: removes `{ rows, total }` wrapper). `Content-Range`, `Range-Unit`, and `X-Total-Count` headers added. `Prefer: count=exact|planned|estimated` support.
- **E-01 — HEAD list** — same SQL as GET, no body (RFC 9110). `limit=0 + HEAD` skips row fetch entirely, only runs count.
- **E-02 — OPTIONS Allow header** — returns `Allow: GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS`; no DB access required.
- **C-02 — POST Prefer** — `return=minimal|representation|headers-only`, `resolution=merge-duplicates|ignore-duplicates`, `missing=default|null`, `on_conflict=`, `columns=` whitelist.
- **C-03 — PATCH Prefer** — `return=minimal|representation`. Filterless full-table PATCH blocked (requires at least one `where=` condition).
- **C-04 — DELETE Prefer** — `return=minimal|representation`. Same filter requirement as PATCH.
- **C-05 / C-06 — PUT upsert + GET /:id** — PUT tries UPDATE → falls back to INSERT on 0 rows. `Prefer: resolution`. GET `/:id` supports `?select=`.
- **E-09 / E-10 — RPC GET/POST** — `GET|POST /:database/rpc/:function`. Named args, `Prefer: params=single-object`, `return=minimal`. GET rejects VOLATILE functions (405). Bad arg types → 400.
- **E-11 — Full-Text Search operators** — `fts`, `plfts`, `phfts`, `wfts` with optional language (`plfts(turkish)`). Language and query always bound params.
- **E-12 — Array / range operators** — `cs @>`, `cd <@`, `ov &&`, `sl <<`, `sr >>`, `nxl &>`, `nxr &<`, `adj -|-`. Array `{a,b}` bound as JS array; range `[lo,hi]` bound with allowlisted cast (`numrange`, `daterange`, `tsrange`).
- **E-13 — like(any|all) / ilike(any|all)** — `col.like(any).{A*,B*}` → OR chain; `ilike(all)` → AND chain. `*` → `%`, `?` → `_`. All patterns parameterized.
- **E-14 — JSON / JSONB path filters** — `settings->>'theme'.eq.dark`, nested `attrs->'specs'->>'weight'.lt.5`, array index `data->0->>'name'`. Root identifier + every path segment validated via strict allowlist regex.
- **E-17 — Select aliases** — `select=alias:expr` (plain, JSON path, cast). Single `:` is alias; `::` stays cast. Alias validated with `isValidIdentifier`.
- **E-18 — Type casts** — `col::numeric`, `settings->>'n'::float`. Only allowlisted PostgreSQL types accepted.
- **E-19 — JSON path AS alias** — bare `settings->>'theme'` in `select` now emits `AS "theme"` instead of `?column?`. PostgREST-compatible response keys.
- **E-25 — Readiness probe** — `GET /ready` and `GET /health/ready`. Pings system DB and all active pools. Returns `200 {ready:true}` or `503 {ready:false}`.

### Added — Per-DB Auth GoTrue Session Shape

- **C-07 — Login** — `POST /auth/login` now returns GoTrue snake_case session: `access_token`, `token_type`, `expires_in`, `expires_at`, `refresh_token`, enriched `user` (`aud`, `app_metadata`, `user_metadata`). Shared `sessionResponse.ts` builder used by all auth endpoints.
- **C-08 — Refresh token rotation + reuse detection** — `POST /auth/refresh`. Rotation on every use. Grace period (ADR-012): reuse within `REFRESH_TOKEN_REUSE_INTERVAL_SECONDS` allowed; outside grace → entire session family revoked + audit event `refresh_token_reuse`.
- **C-09 — Logout scope** — `POST /auth/logout?scope=global|local|others`. `global` and `others` require `Authorization: Bearer`. All revocations set `revoked_at`.
- **C-10 — Signup** — `POST /auth/signup` returns GoTrue session (200). When `email_verify_required=true`, returns empty token strings with same shape + `email_verify_sent: true`.
- **C-11 — Email verify** — `GET /auth/verify` returns GoTrue session. Supports `type=signup|invite|email`. Optional `redirect_to` → 302 with tokens in URL fragment (`#access_token=…`).
- **C-12 — Magic link verify** — `GET /auth/magic-link/verify` returns GoTrue session. TTL from `magic_link_ttl_minutes` setting. Tokens single-use (cleared from `metadata` on use).
- **C-13 — OAuth callback fragment** — Callback redirect fragment now includes `access_token`, `refresh_token`, `token_type=bearer`, `expires_in`, `expires_at`, `type=oauth`.
- **C-14 — OAuth initiate redirect_to + scopes** — `?redirect_to=` validated against `APP_URL` origin before writing to state store. `?scopes=` overrides default provider scopes.
- **C-15 / C-16 — Password forgot / reset** — Both return `{}` (GoTrue-compatible). Reset token single-use; `revoke_sessions_on_password_reset` setting (default `true`).
- **C-17 — Users list pagination** — `GET /auth/users` supports `page`, `per_page` (max 100), and filters: `email`, `role`, `is_active`, date ranges. Response includes `next_page`, `last_page`, `aud`.
- **C-18 — User admin patch** — `PATCH /auth/users/:id` supports `email_confirm`, `ban_duration` (`24h` / `none`), `user_metadata`, `app_metadata`, `password` (revokes sessions on change).
- **C-20 — Public settings** — `GET /auth/settings` returns GoTrue-style public shape (`external.google`, `disable_signup`, `mailer_autoconfirm`, …). With admin/schema Bearer, returns full flat settings for the GUI.
- **`redirectSafe.ts`** — shared `safeAppRedirect` (same-origin whitelist) and `sessionFragment` (URL fragment builder) used by verify, magic-link, and OAuth endpoints.

### Fixed — Security

- **RPC named arg SQL injection** — arg names from request body were interpolated directly into SQL. Now validated with `assertIdentifier` before use.
- **Refresh token grace bypass** — expired + revoked tokens could re-enter the rotation chain within the grace window. Expiry is now checked before grace; absolute expiry is never waived.
- **`estimated` count wrong schema** — `pg_class` query lacked a `pg_namespace` join; on databases with same-name tables in multiple schemas, the wrong row count could be returned.
- **`Content-Range: 0-0/N` RFC 7233 violation** — empty result sets now emit `*/N` (or no header when total is unknown) instead of the misleading `0-0/N`.
- **`columns=` + `missing=default` null INSERT** — when a `columns=` whitelist was provided and a row omitted a listed column, `null` was inserted instead of the DB default. Fixed by excluding the column from the INSERT list entirely when `missing=default`.
- **PUT upsert `RETURNING` anti-pattern** — `returningClause || " RETURNING *"` fell through to `RETURNING *` even when `return=minimal`, preventing the 0-row detection needed to trigger the INSERT fallback.

---

## [0.3.0] — 2026-08-09

### Added — New Systems
- **Backup Management** — full backup platform: list, create, delete, restore via file upload, automatic cron schedule. Backups stored in `_postgrify_backups` table, files in `/data/backups`. Streaming HTTP response prevents OOM on large databases. Separate `BackupTab` component in GUI
- **IP Allowlist** — per-database independent access control with 3 modes: everyone, same network (/24 subnet), or manual IP/CIDR list. `ipUtils.ts` handles IPv4 bitwise, IPv6 BigInt, IPv4-mapped normalization with zero dependencies. 30-second in-process cache. Both API and DB auth endpoints (including login) are guarded
- **Backup Scheduler** — `backupScheduler.ts` loads active schedules on server startup and sets up cron jobs. Schedule updates cancel and reschedule jobs. Stored in `settingsService.ts` as `backup_schedule:<dbName>` key
- **Changelog Page + Update Modal** — parses `CHANGELOG.md` and shows color-coded version list at `/changelog`. On new version, a "new version" modal appears once after login, dismissed via `localStorage` key `postgrify_seen_version`. "Changes" link in sidebar
- **Global Error Handler Plugin** — `plugins/errorHandler.ts` hides stack traces and internal error messages in production, returns loggable `errorId` (UUID). Full detail shown in development
- **Emergency Admin Reset Tool** — `scripts/reset-admin.ts`: when admin password is forgotten, run via `npx tsx scripts/reset-admin.ts --email x --password y` over SSH. Generates argon2id hash and writes to `.env`
- **Docker Entrypoint Script** — `docker-entrypoint.sh` creates `/data/backups` directory with correct permissions, switches to `postgrify` user via `su-exec`

### Added — Security
- **Rate Limit → Redis Backend** (CRIT-2 closed) — distributed rate limiting via `ioredis` when `REDIS_URL` is set. All instances share the same counter in multi-container setups. Falls back to in-memory with warning log
- **Account Lockout** — brute-force protection: `failed_attempts` + `locked_until` columns added to `users` table. 15-minute lockout after 5 failed attempts, reset on successful login. Per-database configurable (`account_lockout_attempts`, `account_lockout_minutes`)
- **OAuth Token → URL Fragment** (HIGH-1 closed) — tokens now arrive as `#access_token=` fragment instead of `?access_token=` query param. Fragments never reach the server or nginx logs
- **OAuth Open Redirect Protection** (HIGH-2 closed) — `signup_redirect_url` is validated against `APP_URL` origin; redirects to different domains are rejected
- **`signup_redirect_url` Protocol Whitelist** — `javascript:` and `data:` protocols rejected in settings endpoint
- **Upload Magic Bytes Validation** — `Content-Type: image/jpeg` with PHP content → 415. JPEG, PNG, WebP, GIF, BMP file signatures verified
- **Password Policy System** — `utils/passwordPolicy.ts`: per-database configurable min length, uppercase, digits, special characters. Integrated into signup and password reset
- **API Key Timing-Safe Comparison** — `crypto.timingSafeEqual()` closes timing attack vector
- **Cache Key Poisoning Protection** — `buildKey()` sanitizes `:` and spaces
- **Admin Stats → Auth Required** — `GET /admin/stats` now requires admin token; active DB list, uptime, Node version no longer public
- **trustProxy Subnet Restriction** — `"127.0.0.1, 172.16.0.0/12"` prevents external `X-Forwarded-For` spoofing
- **nginx Security Headers** — `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `HSTS`, `Referrer-Policy` added

### Fixed
- Setup page no longer appears after `docker compose down -v && up` when `.env` still contains stale credentials — `isConfiguredAsync()` now checks DB for a real admin record as the source of truth
- Admin login no longer fails with "credentials not configured" after container restart — pool plugin hydrates credentials from DB on startup
- Setup page no longer flashes on GUI when API container is still starting up — React Query retries with exponential backoff instead of caching a false "not configured" result
- Setup → direct dashboard: API returns `accessToken` on setup completion, `loginWithTokens()` opens session immediately without returning to login page
- `SetupGuard` race condition: spinner shown during retries instead of redirecting to setup before API is ready
- `AuthProvider` → `SetupGuard` wrapping order corrected: `SetupGuard` is now inside `AuthProvider` so auth state is accessible during setup check

### Changed
- `DatabasePage` `BackupTab` extracted to separate `components/database/BackupTab.tsx` (was ~150 inline lines)
- `ConnectionsTab` redesigned to match app design language: `max-w-lg`, `bg-card` cards, `text-xs font-mono` values, `border-b border-border/40` dividers
- `useSetupStatus` React Query hook: `staleTime: 0`, `gcTime: 0`, `retry: 5` with exponential backoff
- `getSetupStatus()` in `lib/api.ts`: throws on HTTP error instead of silently returning `{configured: false}`
- Admin credentials persisted to PostgreSQL (`_postgrify_settings`) — survives container restarts and volume-preserving redeploys

---

## [0.1.0] — 2026-07-01

### Added
- Initial release
- Multi-database PostgreSQL gateway (Fastify REST API)
- React GUI for table, schema, and SQL management
- Per-database lazy connection pools
- Admin authentication (argon2id + JWT)
- Per-database auth system (`_postgrify_auth` schema)
- Backup system (pg_dump/pg_restore + scheduler)
- IP allowlist per database
- Rate limiting, CORS, audit logging
- Redis cache support with in-memory LRU fallback
- `@postgrify/auth-js` zero-dependency SDK
- First-run setup wizard
- Docker Compose development and production configs