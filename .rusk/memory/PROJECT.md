# Postgrify — Project

**Amaç:** Tek PostgreSQL sunucusunda çok veritabanı, tek HTTP/REST API.
Her proje DB adını URL/header/param ile belirtir; doğrudan PG bağlantısı yok.

**Stack:** Fastify + TypeScript | postgres.js | jose (JWT) | Redis/LRU cache | React+Vite GUI

**Monorepo:** npm workspaces
- `packages/api` — Fastify REST API
- `packages/gui` — React + Vite + Tailwind
- `packages/auth-js` — per-DB auth SDK (Supabase-benzeri)

**Entry:** `packages/api/src/index.ts`
**Config:** `packages/api/src/config/env.ts` (Zod validated)

**DB seçim önceliği:** URL param > X-Database header > ?database= query param

**Uyum hedefi (2026-08):** Row CRUD → PostgREST v12; per-DB auth → GoTrue shape.
Detay: `PLAN-endpoints.md`, `ARCHITECTURE-endpoints.md`.

**Agent notu:** Geliştirme/plan durumunu `.rusk/memory/` altında tut; session başında ACTIVE + PLAN oku.