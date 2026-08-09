# SDK Gap Analysis & Implementation Plan
**Date:** 2026-08-09  
**Scope:** `@postgrify/auth-js` vs full API surface

---

## Executive Summary

The SDK currently covers only **per-database end-user auth** (the `/db/:database/auth/*` group). It has zero coverage of admin operations, data-layer operations (tables, rows, queries, meta, backup), and several auth endpoints that exist in the API but are absent from the SDK. Internal quality issues (type safety, error handling, session management) also need addressing.

---

## Part 1 — API Endpoint Inventory

### 1A. Admin Auth (`/auth/*`)
| Method | Endpoint | SDK Coverage |
|--------|----------|-------------|
| POST | `/auth/token` | ❌ Missing |
| POST | `/auth/token/admin` | ❌ Missing |
| POST | `/auth/admin/login` | ❌ Missing |
| POST | `/auth/logout` | ❌ Missing |
| POST | `/auth/refresh` | ❌ Missing |
| GET | `/auth/me` | ❌ Missing |
| GET | `/auth/sessions` | ❌ Missing |
| DELETE | `/auth/sessions/:id` | ❌ Missing |

### 1B. Admin DB Management (`/admin/*`)
| Method | Endpoint | SDK Coverage |
|--------|----------|-------------|
| GET | `/admin/databases` | ❌ Missing |
| POST | `/admin/databases` | ❌ Missing |
| PATCH | `/admin/databases/:name` | ❌ Missing |
| DELETE | `/admin/databases/:name` | ❌ Missing |
| POST | `/admin/databases/:name/test` | ❌ Missing |
| GET | `/admin/stats` | ❌ Missing |
| GET | `/admin/settings` | ❌ Missing |
| POST | `/admin/settings` | ❌ Missing |

### 1C. DB Data Layer (`/db/:database/*`)
| Method | Endpoint | SDK Coverage |
|--------|----------|-------------|
| GET | `/db/:db/tables` | ❌ Missing |
| POST | `/db/:db/tables` | ❌ Missing |
| GET | `/db/:db/tables/:table` | ❌ Missing |
| PATCH | `/db/:db/tables/:table` | ❌ Missing |
| DELETE | `/db/:db/tables/:table` | ❌ Missing |
| POST | `/db/:db/tables/:table/columns` | ❌ Missing |
| PATCH | `/db/:db/tables/:table/columns/:col` | ❌ Missing |
| DELETE | `/db/:db/tables/:table/columns/:col` | ❌ Missing |
| GET | `/db/:db/tables/:table/rows` | ❌ Missing |
| POST | `/db/:db/tables/:table/rows` | ❌ Missing |
| PATCH | `/db/:db/tables/:table/rows/:id` | ❌ Missing |
| DELETE | `/db/:db/tables/:table/rows/:id` | ❌ Missing |
| POST | `/db/:db/query` | ❌ Missing |
| GET | `/db/:db/meta` | ❌ Missing |
| POST | `/db/:db/backup` | ❌ Missing |

### 1D. Per-DB Auth (`/db/:database/auth/*`)
| Method | Endpoint | SDK Coverage |
|--------|----------|-------------|
| POST | `/auth/login` | ✅ `signIn()` |
| POST | `/auth/logout` | ✅ `signOut()` |
| POST | `/auth/refresh` | ✅ internal (SessionManager) |
| POST | `/auth/signup` | ✅ `signUp()` |
| GET | `/auth/verify?token=` | ✅ `verifyEmail()` |
| GET | `/auth/me` | ✅ `getUser()` |
| POST | `/auth/password/forgot` | ✅ `resetPassword()` |
| POST | `/auth/password/reset` | ✅ `updatePassword()` |
| POST | `/auth/magic-link` | ✅ `signInWithMagicLink()` |
| GET | `/auth/magic-link/verify?token=` | ✅ `verifyMagicLink()` |
| GET | `/auth/oauth/:provider` | ✅ `signInWithOAuth()` |
| GET | `/auth/oauth/:provider/callback` | ❌ Missing (only URL redirect, no code-exchange helper) |
| GET | `/auth/users` | ❌ Missing (admin-scoped, but no SDK method) |
| POST | `/auth/users` | ❌ Missing |
| GET | `/auth/users/:id` | ❌ Missing |
| PATCH | `/auth/users/:id` | ❌ Missing |
| DELETE | `/auth/users/:id` | ❌ Missing |
| PATCH | `/auth/users/me/password` | ❌ Missing (vs `updatePassword` which uses token flow) |
| GET | `/auth/settings` | ❌ Missing |
| PUT | `/auth/settings` | ❌ Missing |
| GET | `/auth/settings/oauth/:provider` | ❌ Missing |
| POST | `/auth/settings/oauth/:provider` | ❌ Missing |
| DELETE | `/auth/settings/oauth/:provider` | ❌ Missing |
| GET | `/auth/audit` | ❌ Missing |
| GET | `/auth/sessions` | ❌ Missing |
| DELETE | `/auth/sessions/:id` | ❌ Missing |
| DELETE | `/auth/sessions` (by user_id) | ❌ Missing |

---

## Part 2 — SDK Quality Issues (Existing Code)

### 2.1 Type Safety
- `client.ts` uses `any` in several places (HTTP response bodies, error objects).
- `AuthError` class has `code?: string` but no exhaustive union type — callers cannot discriminate errors without string matching.
- `signInWithOAuth()` returns `void` instead of a typed redirect descriptor — impossible to test without a browser.
- `SessionManager` stores `session: Session | null` but `Session.user` is typed with partial optionals — field presence is unverifiable at compile time.

### 2.2 Error Handling
- `_request()` in client.ts catches HTTP errors generically; non-JSON error bodies (e.g. 502 from nginx) will throw an unhandled JSON parse error.
- No retry logic for transient network failures (5xx, ECONNRESET).
- No timeout support — a hanging request will never resolve.
- `onAuthStateChange` subscribers receive errors only if the SDK internally triggers a state change; errors during `signIn` etc. are thrown to the caller but not broadcast to listeners.

### 2.3 Session Management
- Refresh is scheduled by `SessionManager` using `setTimeout`, but there is no guard against multiple concurrent refreshes (race condition if `signIn` is called while a refresh is in flight).
- `SessionManager.clear()` cancels the timer but does not revoke the server-side session — `signOut()` must be called explicitly; this is undocumented.
- No "session restored from storage" event is emitted on SDK initialization, meaning listeners initialized after `createClient()` miss the initial session.

### 2.4 Storage Adapter
- `storage.ts` provides `localStorage`, `sessionStorage`, and `memory` adapters but no `cookie` adapter — required for SSR/server-side frameworks (Next.js, Nuxt, SvelteKit).
- No way to inject a custom storage adapter via `createClient()` options.

### 2.5 OAuth Flow
- `signInWithOAuth()` performs a `window.location.assign()` directly — untestable, not server-renderable, and not configurable (no popup option).
- No PKCE implementation for the authorization code flow — required for public clients (mobile, SPA) per RFC 7636 and OAuth 2.1.
- OAuth callback URL is hardcoded as `${url}/db/${database}/auth/oauth/${provider}/callback` — no way to override for custom domains.

### 2.6 Missing SDK-Level Features
- **No admin client**: there is no `createAdminClient()` / `AdminClient` class for server-side admin operations (user management, settings, audit log, sessions management).
- **No data client**: the API exposes a full REST data layer (tables, rows, query) but the SDK has zero coverage.
- **No token client**: `POST /auth/token` (DB-scoped JWT issuance) is not in the SDK — needed for backend-to-backend use.
- **No health/meta utility**: no way to call `GET /health` or `GET /db/:db/meta` from the SDK.
- **No TypeScript generics on row data**: a `from('table').select()` style builder is absent; callers must type raw fetch responses themselves.

### 2.7 Documentation & DX
- No JSDoc on any public method.
- `createClient()` options type (`ClientOptions`) is missing `timeout`, `retries`, `storage`, `fetch` (custom fetch implementation) fields.
- No README in `packages/auth-js/` explaining install, usage, or examples.
- No `index.ts` barrel re-exporting all public types — consumers must import from internal paths.

---

## Part 3 — Prioritized Implementation Plan

### Phase 1 — Foundation Fixes (highest ROI, unblock everything else)
1. **Fix `_request()` error handling** — safe JSON parse, typed `AuthError` codes, timeout support.
2. **Fix refresh race condition** in `SessionManager` — use an in-flight promise guard.
3. **Add custom storage adapter support** to `ClientOptions` — unblocks SSR use.
4. **Add JSDoc to all existing public methods** — minimal documentation baseline.
5. **Audit and tighten all TypeScript types** — eliminate `any`, define `AuthErrorCode` union.

### Phase 2 — Missing Auth Endpoints (core SDK surface)
6. **Admin user management** methods: `admin.listUsers()`, `admin.getUser()`, `admin.createUser()`, `admin.updateUser()`, `admin.deleteUser()`.
7. **Auth settings** methods: `admin.getSettings()`, `admin.updateSettings()`, `admin.listOAuthProviders()`, `admin.setOAuthProvider()`, `admin.deleteOAuthProvider()`.
8. **Session management** methods: `admin.listSessions()`, `admin.deleteSession()`, `admin.deleteUserSessions()`.
9. **Audit log** method: `admin.getAuditLog({ page, limit, userId? })`.
10. **OAuth PKCE flow** — implement code verifier/challenge generation, store verifier in session storage, exchange code on callback.
11. **`updateProfile()` method** — `PATCH /auth/users/me/password` authenticated password change (separate from token-based `updatePassword`).

### Phase 3 — Admin & Data Client
12. **`createAdminClient()`** factory — new `AdminClient` class with full admin auth + DB management surface.
    - DB management: `listDatabases()`, `createDatabase()`, `updateDatabase()`, `deleteDatabase()`, `testDatabase()`.
    - Stats: `getStats()`, `getSettings()`, `updateSettings()`.
    - Admin auth: `login()`, `logout()`, `refresh()`, `me()`, `listSessions()`, `deleteSession()`.
13. **`createDataClient()`** factory — new `DataClient` class for DB data layer.
    - Table management: `listTables()`, `createTable()`, `getTable()`, `updateTable()`, `deleteTable()`.
    - Column management: `addColumn()`, `updateColumn()`, `deleteColumn()`.
    - Row CRUD: `from(table).select(filters)`, `from(table).insert(data)`, `from(table).update(id, data)`, `from(table).delete(id)`.
    - Raw query: `query(sql, params)`.
    - Meta: `getMeta()`.
    - Backup: `backup(options)`.

### Phase 4 — Cookie Adapter & SSR Support
14. **Cookie storage adapter** for Next.js/Nuxt/SvelteKit server environments.
15. **`getServerSession(request, response)`** helper for SSR page hydration.
16. **Separate ESM/CJS build** verification — ensure tree-shaking works correctly.

### Phase 5 — DX & Documentation
17. **README.md** for `packages/auth-js/` with quick-start, all methods, types, error codes.
18. **`index.ts` barrel exports** — all public types, factories, constants in one place.
19. **Add `timeout` and `retries` to `ClientOptions`**.
20. **Unit tests** for all new methods using Vitest + mock fetch.

---

## Part 4 — File Structure After Full Implementation

```
packages/auth-js/src/
  index.ts             — public barrel (types + all factory functions)
  client.ts            — PostgrifyClient (end-user auth, renamed for clarity)
  adminClient.ts       — AdminClient (NEW)
  dataClient.ts        — DataClient (NEW)
  session.ts           — SessionManager (existing, hardened)
  storage.ts           — storage adapters (existing + cookie adapter)
  pkce.ts              — PKCE helpers (NEW)
  errors.ts            — AuthError + AuthErrorCode union (NEW)
  http.ts              — shared _request() with timeout/retry (NEW)
  types.ts             — all shared types (existing, expanded)
```

---

## Summary Statistics

| Category | API Endpoints | SDK Covered | Gap |
|----------|--------------|-------------|-----|
| Per-DB end-user auth | 26 | 11 | **15 missing** |
| Admin auth | 8 | 0 | **8 missing** |
| Admin DB management | 8 | 0 | **8 missing** |
| DB data layer | 15 | 0 | **15 missing** |
| **Total** | **57** | **11** | **46 missing (81%)** |

Quality issues identified: **7 categories** (type safety, error handling, session management, storage, OAuth/PKCE, admin client, documentation).