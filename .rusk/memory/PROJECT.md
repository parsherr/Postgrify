# Postgrify — Project

**Amaç:** Tek PostgreSQL sunucusunda çok veritabanı, tek HTTP/REST API.
Her proje DB adını URL/header/param ile belirtir; doğrudan PG bağlantısı yok.

**Stack:** Fastify + TypeScript | postgres.js | jose (JWT) | Redis/LRU cache | React+Vite GUI

**Monorepo:** npm workspaces
- `packages/api` — Fastify REST API
- `packages/gui` — React + Vite + Tailwind

**Entry:** `packages/api/src/index.ts`
**Config:** `packages/api/src/config/env.ts` (Zod validated)

**DB seçim önceliği:** URL param > X-Database header > ?database= query param