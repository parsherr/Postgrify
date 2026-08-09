# Changelog

All notable changes to Postgrify are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [0.2.0] — 2026-08-09

### Fixed
- Setup page no longer appears after `docker compose down -v && up` when `.env` still contains stale credentials — `isConfiguredAsync()` now checks DB for a real admin record as the source of truth
- Admin login no longer fails with "credentials not configured" after container restart — pool plugin hydrates credentials from DB on startup
- Setup page no longer flashes on GUI when API container is still starting up — React Query retries with exponential backoff instead of caching a false "not configured" result

### Added
- Admin credentials persisted to PostgreSQL (`_postgrify_settings` table) — survives container restarts and volume-preserving redeploys
- `SettingsService.setAdminCredentials` / `getAdminCredentials` — DB-backed credential storage
- `SettingsService.getAdminSetupCompleted` / `setAdminSetupCompleted` — DB-backed setup flag
- `GET /setup/status` now verifies actual DB admin record, not just env vars
- Pool plugin `onReady` hook: loads admin credentials from DB if env is empty (container restart recovery)
- `adminLogin` route: falls back to DB credential lookup if config is empty

### Changed
- `useSetupStatus` React Query hook: `staleTime: 0`, `gcTime: 0`, `retry: 5` with exponential backoff — prevents stale cache from hiding setup state changes
- `getSetupStatus()` in `lib/api.ts`: throws on HTTP error instead of silently returning `{configured: false}`

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