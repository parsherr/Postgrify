# Architecture Decisions

## ADR-001: Lazy Connection Pool
**Karar:** Her DB için lazy postgres.js pool (ilk istekte aç, idle'da kapat)
**Neden:** Aktif olmayan DB'ler için kaynak israfı önlenir; 100 DB tanımlı olsa bile yalnızca kullanılanlar bağlantı tutar.

## ADR-002: Redis Opsiyonel
**Karar:** Redis URL yoksa in-memory LRU (lru-cache) devreye girer
**Neden:** Küçük kurulumlar için Redis zorunlu kılmak overhead; production'da Redis önerilir.

## ADR-003: SELECT-only Ham SQL
**Karar:** /db/:db/query endpoint'i varsayılan olarak yalnızca SELECT kabul eder
**Neden:** Yetkisiz DDL/DML koruması; admin token + ALLOW_RAW_SQL_ADMIN=true ile açılır.

## ADR-004: Identifier Validation
**Karar:** Tablo/kolon/DB adları `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/` regex + reserved keyword blocklist
**Neden:** SQL injection'ın parametrik sorgu dışındaki vektörünü kapatır (dinamik tablo adları).

## ADR-005: Scope-based Authorization
**Karar:** JWT claim'de scope dizisi: read/write/delete/schema/query
**Neden:** Tek DB içinde okuma-yazma ayrımı; frontend-only client'lara write vermemek mümkün.

## ADR-006: PUT /:id — upsert + Prefer (2026-08-16)
**Karar:** Path `/:id` Postgrify DX olarak korunur. PUT satır yoksa INSERT (upsert); `Prefer: return` desteklenir. Full-table PostgREST `PUT ?pk=eq` ayrı shorthand filtrelerle gelir.
**Neden:** Breaking path kaldırmak GUI/SDK'yı gereksiz kırar; semantik PostgREST'e yaklaşır.

## ADR-007: List response = array + Content-Range (2026-08-16)
**Karar:** `GET /db/:db/:table` `{rows,total,limit,offset}` wrapper'ı kaldırılır; body JSON array, sayım `Content-Range` + `Prefer: count=*`.
**Neden:** PostgREST uyumu; gereksiz COUNT maliyeti kalkar. GUI `Prefer: count=exact` gönderir.

## ADR-008: Auth snake_case + dual request accept (2026-08-16)
**Karar:** Auth response alanları GoTrue snake_case. Request body hem `refresh_token` hem `refreshToken` kabul.
**Neden:** SDK/Supabase client uyumu; mevcut client'lara yumuşak geçiş.

## ADR-011: user.role = authenticated; Postgrify role in app_metadata (2026-08-16)
**Karar:** Login `user.role` GoTrue gibi `"authenticated"`; Postgrify scope (`viewer|editor|admin`) → `app_metadata.role` (+ `is_active`).
**Neden:** Supabase client uyumu; JWT scope ayrı claim'de kalır (`signDbUserToken`).

## ADR-012: Refresh reuse grace (2026-08-16)
**Karar:** `REFRESH_TOKEN_REUSE_INTERVAL_SECONDS` (default 10) içinde revoked token ile tekrar refresh → yeni rotation (plaintext successor saklanmaz). Interval dışı → kullanıcının tüm aktif session'ları revoke + audit `refresh_token_reuse`.
**Neden:** Eşzamanlı client isteklerine tolerans; GoTrue family revoke saldırı modeline yaklaşım.

## ADR-013: Public auth settings + admin enrich (2026-08-16)
**Karar:** `GET /db/:db/auth/settings` auth gerektirmez (api key hâlâ group hook). Response GoTrue public shape (`external`, `disable_signup`, `mailer_autoconfirm`). Admin/schema Bearer ile aynı path flat string ayarları + aliases döner (GUI `=== "true"` kırılmaz).
**Neden:** SDK/frontend provider keşfi; mevcut AuthsTab string karşılaştırmaları korunur.

## ADR-009: Batch mutate filter zorunlu kalır (2026-08-16)
**Karar:** PATCH/DELETE without `where` → 400. Response'a `X-Postgrify-Require-Filter: true`.
**Neden:** PostgREST full-table mutate'e izin verir; Postgrify güvenlik tercihi bilinçli sapma.

## ADR-010: Scope-out Storage/MFA/SSO (2026-08-16)
**Karar:** Bu PR'da Storage, MFA, OTP, PKCE, SSO yok; ayrı epic.
**Neden:** Reviewable diff; önce query+auth sözleşmesi.