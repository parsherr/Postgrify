# Changelog

All notable changes to Postgrify are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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