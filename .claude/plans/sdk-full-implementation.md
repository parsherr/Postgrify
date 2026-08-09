# SDK Full Implementation Plan
**Date:** 2026-08-09
**Goal:** Production-quality `@postgrify/auth-js` SDK — all API endpoints covered, all quality issues fixed, full test suite

---

## Target File Structure

```
packages/auth-js/src/
  index.ts              — public barrel (all exports)
  errors.ts             — AuthError class, AuthErrorCode union (NEW)
  http.ts               — shared _request() with timeout/retry (NEW)
  types.ts              — all shared types (expanded)
  client.ts             — PostgrifyAuth (end-user auth, fixed)
  adminClient.ts        — AdminClient (NEW)
  dataClient.ts         — DataClient with from() query builder (NEW)
  session.ts            — SessionManager (race condition fixed)
  storage.ts            — storage adapters + custom adapter support (expanded)

packages/auth-js/test/
  setup.ts              — vitest setup, fetch mock helpers
  client.test.ts        — PostgrifyAuth unit tests
  adminClient.test.ts   — AdminClient unit tests
  dataClient.test.ts    — DataClient unit tests
  session.test.ts       — SessionManager unit tests
  storage.test.ts       — storage adapters unit tests
  errors.test.ts        — AuthError unit tests
  http.test.ts          — _request() unit tests (timeout, retry, error parsing)
```

---

## Implementation Steps (in order)

### Step 1 — errors.ts
Define `AuthErrorCode` exhaustive union + `PostgrifyError` class that extends Error.
Replaces the bare `AuthError` interface.

### Step 2 — http.ts
Shared `request()` function with:
- Timeout support (AbortController, configurable, default 30s)
- Retry on 5xx / network errors (configurable, default 2 retries, exponential backoff)
- Safe JSON parse (never throws on non-JSON bodies)
- Typed `PostgrifyError` on failures
- X-API-Key or Bearer token injection

### Step 3 — types.ts (expand)
Add all missing types:
- `AdminUser`, `AdminSession`, `AdminStats`, `DatabaseInfo`
- `AuthSettings`, `OAuthProvider`
- `AuditLogEntry`, `DbSession`
- `TableInfo`, `ColumnInfo`, `RowFilter`, `QueryResult`
- `AdminClientConfig`, `DataClientConfig`
- `CustomStorageAdapter` interface
- Fix `AuthSession.user` to be non-optional
- Fix `SignUpResponse` to carry `email_verify_sent` + `user`

### Step 4 — storage.ts (expand)
- Add `CustomStorageAdapter` interface support in `createStorage()`
- Update `PostgrifyAuthConfig.storage` to accept `StorageAdapter | 'localStorage' | ...`
- No behavior change for existing string values

### Step 5 — session.ts (fix)
- Add `_refreshInFlight: Promise<AuthSession | null> | null` guard to prevent concurrent refreshes
- Emit "session restored" event on `setRefreshFn()` when a valid session is found in storage
- Keep all other behavior

### Step 6 — client.ts (fix + extend)
- Fix `signUp()` to return `SignUpResponse` with `email_verify_sent` + `user`
- Fix `handleOAuthCallback()` hardcoded `expiresIn`
- Add `updateProfile()` → `PATCH /auth/me`
- Add JSDoc to ALL public methods
- Wire to new `http.ts` `request()` helper

### Step 7 — adminClient.ts (new)
`AdminClient` class with two sub-namespaces accessible as `.auth` and `.db`.

Methods:
```
auth:
  login(email, password) → AdminSession
  logout() → void
  refresh() → AdminSession
  me() → AdminProfile
  listSessions() → AdminSession[]
  deleteSession(token) → void
  deleteAllSessions() → { revoked: number }
  issueDbToken(database, secret, scope?, expiresIn?) → { token }
  issueAdminToken(adminSecret, expiresIn?) → { token }

db:
  list() → DatabaseInfo[]
  create(name) → { name, api_key }
  delete(name) → void
  getApiKey(name) → { api_key }
  rotateApiKey(name) → { api_key }
  getStats() → AdminStats
```

`createAdminClient(config)` factory exported from `index.ts`.

### Step 8 — dataClient.ts (new)
`DataClient` class with fluent `from()` query builder.

```typescript
// Table management
db.tables.list() → TableInfo[]
db.tables.create({ name, columns }) → { name, created }
db.tables.delete(name) → void
db.tables.schema(name) → ColumnInfo[]
db.tables.addColumn(table, column) → void
db.tables.updateColumn(table, col, changes) → void
db.tables.deleteColumn(table, col) → void

// Row CRUD via from()
db.from<T>(table)
  .select(cols?)    → FluentQuery<T>
  .where(condition) → FluentQuery<T>
  .order(col, dir?) → FluentQuery<T>
  .limit(n)         → FluentQuery<T>
  .offset(n)        → FluentQuery<T>
  .get()            → Promise<{ data: T[], total, limit, offset, error }>

db.from<T>(table).insert(data) → Promise<{ data: T, error }>
db.from<T>(table).update(id, data) → Promise<{ data: T, error }>
db.from<T>(table).delete(id) → Promise<{ error }>
db.from<T>(table).findById(id) → Promise<{ data: T | null, error }>

// Extras
db.query<T>(sql, params?) → Promise<{ data: T[], count, error }>
db.meta.size() → Promise<{ size_bytes, size_human }>
db.meta.stats() → Promise<{ database, tables }>
db.backup.download() → Promise<Blob>  (browser) | Buffer (Node)
```

`createDataClient(config)` factory exported from `index.ts`.

### Step 9 — index.ts (barrel)
Re-export everything:
- `createClient`, `PostgrifyAuth`
- `createAdminClient`, `AdminClient`
- `createDataClient`, `DataClient`
- All types
- `PostgrifyError`, `AuthErrorCode`

### Step 10 — Test Files
Write complete test suite using Vitest + `vi.fn()` fetch mocks:
- `test/setup.ts` — mock fetch utility, `mockFetch(status, body)` helper
- `test/errors.test.ts` — PostgrifyError construction, code discrimination
- `test/http.test.ts` — timeout, retry, JSON parse safety, auth header injection
- `test/storage.test.ts` — all three adapters, custom adapter interface, SSR guard
- `test/session.test.ts` — setSession, clearSession, refresh scheduling, race condition guard, "session restored" event
- `test/client.test.ts` — signUp (check email_verify_sent), signIn, signOut, forgotPassword, resetPassword, updatePassword, getUser, updateProfile, verifyEmail, magic link, OAuth callback, getSession, onAuthStateChange
- `test/adminClient.test.ts` — all admin methods (mocked fetch)
- `test/dataClient.test.ts` — from().get(), insert, update, delete, findById, query, tables CRUD, meta, backup

---

## Constraints

- Zero runtime dependencies (stays true — only devDependencies for build/test)
- Node ≥18 or modern browser (native fetch)
- All files stay under ~300 lines per CLAUDE.md
- TypeScript strict — no `any` in public APIs
- Every public method has JSDoc with `@param`, `@returns`, `@example`
- All tests pass before marking done