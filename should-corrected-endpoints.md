# Postgrify — Düzeltilmesi Gereken Endpoint'ler

> Postgrify'da mevcut olan ancak PostgREST v12 ve Supabase GoTrue'nun standart
> davranışından sapan endpoint'ler. Her madde: mevcut durum → beklenen davranış → fark → düzeltme notu.
>
> **Öncelik:** ⭐⭐⭐ Kritik · ⭐⭐ Önemli · ⭐ Nice-to-have
> **Kaynak:** P = PostgREST referansı · S = Supabase GoTrue referansı · PS = Her ikisi

---

## İçindekiler

1. [Row CRUD Uyumsuzlukları](#1-row-crud-uyumsuzlukları)
   - [C-01 GET /db/:database/:table](#c-01-get-dbdatabasetable)
   - [C-02 POST /db/:database/:table](#c-02-post-dbdatabasetable)
   - [C-03 PATCH /db/:database/:table](#c-03-patch-dbdatabasetable)
   - [C-04 DELETE /db/:database/:table](#c-04-delete-dbdatabasetable)
   - [C-05 PUT /db/:database/:table/:id](#c-05-put-dbdatabasetableid)
   - [C-06 GET /db/:database/:table/:id](#c-06-get-dbdatabasetableid)
2. [Auth — Login / Refresh / Logout](#2-auth--login--refresh--logout)
   - [C-07 POST /db/:database/auth/login](#c-07-post-dbdatabaseauthlogin)
   - [C-08 POST /db/:database/auth/refresh](#c-08-post-dbdatabaseauthrefresh)
   - [C-09 POST /db/:database/auth/logout](#c-09-post-dbdatabaseauthlogout)
3. [Auth — Signup](#3-auth--signup)
   - [C-10 POST /db/:database/auth/signup](#c-10-post-dbdatabaseauthsignup)
4. [Auth — Email Verify](#4-auth--email-verify)
   - [C-11 GET /db/:database/auth/verify](#c-11-get-dbdatabaseauthverify)
5. [Auth — Magic Link](#5-auth--magic-link)
   - [C-12 GET /db/:database/auth/magic-link/verify](#c-12-get-dbdatabaseauthmagic-linkverify)
6. [Auth — OAuth](#6-auth--oauth)
   - [C-13 GET /db/:database/auth/oauth/:provider/callback](#c-13-get-dbdatabaseauthoauthprovidercallback)
   - [C-14 GET /db/:database/auth/oauth/:provider](#c-14-get-dbdatabaseauthoauthprovider)
7. [Auth — Password Reset](#7-auth--password-reset)
   - [C-15 POST /db/:database/auth/password/forgot](#c-15-post-dbdatabaseauthpasswordforgot)
   - [C-16 POST /db/:database/auth/password/reset](#c-16-post-dbdatabaseauthpasswordreset)
8. [Auth — Admin Users ve Settings](#8-auth--admin-users-ve-settings)
   - [C-17 GET /db/:database/auth/users](#c-17-get-dbdatabaseauthusers)
   - [C-18 PATCH /db/:database/auth/users/:id](#c-18-patch-dbdatabaseauthusersid)
   - [C-19 POST /db/:database/auth/signup (token davranışı)](#c-19-post-dbdatabaseauthsignup-token-davranışı)
   - [C-20 GET /db/:database/auth/settings](#c-20-get-dbdatabaseauthsettings)

---

## 1. Row CRUD Uyumsuzlukları

### C-01 `GET /db/:database/:table`

**Kaynak:** P  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/users?select=name&where=age.gt.18&order=age&sort=name&limit=20&offset=0
→ 200 OK
  {
    "data": [{ "id": 1, "name": "Ali" }],
    "total": 150,
    "limit": 20,
    "offset": 0
  }
```

- Response her zaman `{ data, total, limit, offset }` wrapper objesi
- `total` için her sorgu mutlaka bir `SELECT COUNT(*)` çalıştırır (performans sorunu)
- `select` sadece `"name,email"` kolon listesi — alias, cast, JSON path yok
- `order` + `sort` iki ayrı parametre — PostgREST'te tek `order` parametresi
- `or` query param kısmen var ama nested logic yok
- `Content-Range` response header yok
- `Prefer` header hiç okunmuyor

#### PostgREST'te beklenen davranış

```http
GET /mydb/users?select=name&age=gt.18&order=name.asc&limit=20&offset=0
→ 200 OK
  Content-Range: 0-19/*          ← Prefer: count olmadan * (toplam bilinmiyor)
  Content-Type: application/json
  [{ "id": 1, "name": "Ali" }]  ← Direkt array, wrapper yok

# Prefer: count=exact ile:
→ Content-Range: 0-19/150
```

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| Response shape | `{ data: [], total, limit, offset }` wrapper | Direkt JSON array `[...]` |
| COUNT davranışı | Her sorguda mutlaka COUNT(*) çalışır | Yalnızca `Prefer: count=exact/planned/estimated` istenince |
| `Content-Range` header | Yok | Her listeme response'unda döner |
| `select` alias | Desteklenmez (`alias:col`) | Desteklenir |
| `select` cast | Desteklenmez (`col::text`) | Desteklenir |
| `select` JSON path | Desteklenmez (`col->>'key'`) | Desteklenir |
| `order` syntax | `?order=age&sort=name` (iki param) | `?order=name.asc,age.desc` (tek param) |
| `order` null handling | Desteklenmez | `?order=age.asc.nullsfirst` desteklenir |
| Nested OR/AND | Sadece düz `or=` query param | `?or=(a.lt.5,and=(b.eq.1,c.eq.2))` |
| `Prefer: count` header | Okunmuyor | Sayfalama davranışını yönetir |
| Maks. satır limiti | 1000 (hardcoded) | `db-max-rows` konfigürasyonla ayarlanır |

#### Düzeltme notları

- Response wrapper kaldırılıp direkt array döndürülmeli; `total`/`limit`/`offset` `Content-Range` header'a taşınmalı.
- `Prefer: count=exact` istenince COUNT sorgusu çalıştırılmalı; istenmediyse `Content-Range: 0-N/*` döndürülmeli.
- `order` single-param syntax'a geçilmeli: `?order=col.asc.nullsfirst` — `sort` parametresi kaldırılabilir veya backward-compat için korunabilir.
- Bu değişiklik `@postgrify/auth-js` SDK ve GUI `useRows` hook'unu etkiler — `response.data` → doğrudan array.

---

### C-02 `POST /db/:database/:table`

**Kaynak:** PS  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
# Tekil insert:
POST /db/mydb/users
{"name": "Ali", "email": "ali@example.com"}
→ 201 Created
  { "id": 1, "name": "Ali", "email": "ali@example.com" }  ← RETURNING * doğru

# Bulk insert:
POST /db/mydb/users
[{"name": "Ali"}, {"name": "Veli"}]
→ 201 Created
  { "inserted": 2 }  ← Yalnızca sayı, insert edilen satırlar yok
```

Upsert, `Prefer` header ve `columns` query param desteklenmiyor.

#### PostgREST'te beklenen davranış

```http
# Varsayılan (return=minimal):
POST /mydb/users
{"name": "Ali"}
→ 201 Created   ← body yok

# return=representation:
POST /mydb/users
Prefer: return=representation
{"name": "Ali"}
→ 201 Created
  [{"id": 1, "name": "Ali", "email": null, "created_at": "..."}]  ← array

# Upsert:
POST /mydb/users?on_conflict=email
Prefer: resolution=merge-duplicates, return=representation
{"email": "ali@example.com", "name": "Ali v2"}
→ 200 OK
  [{"id": 5, "email": "ali@example.com", "name": "Ali v2"}]

# missing=default (eksik alanlar DB default'u alır):
POST /mydb/products?columns=name,price
Prefer: missing=default
{"name": "Widget"}  ← price yok → DB default kullanılır
```

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| Bulk insert response | `{ inserted: N }` (sayı) | `Prefer: return=representation` ise insert edilen satırların array'i |
| Varsayılan response | Tekil insert için row döner | Varsayılan `return=minimal` → body yok, 201 |
| Upsert desteği | Yok | `?on_conflict=col` + `Prefer: resolution=merge-duplicates/ignore-duplicates` |
| `Prefer: return` | Okunmuyor | `minimal`, `representation`, `headers-only` |
| `Prefer: missing` | Okunmuyor | `default` (DB default), `null` (NULL) |
| `columns` query param | Yok | Body'den hangi kolonların kabul edileceğini sınırlar (güvenlik + bulk performansı) |
| Response format | Tekil: object, Bulk: `{inserted:N}` | Her zaman array (representation istenince) |

#### Düzeltme notları

- `Prefer: return=representation` → `RETURNING *`, array döner.
- `Prefer: return=minimal` (varsayılan) → body yok, 201 döner.
- `Prefer: return=headers-only` → body yok, `Location` header döner.
- `on_conflict` + `Prefer: resolution` → `INSERT ... ON CONFLICT (...) DO UPDATE/NOTHING`.
- Bulk ve tekil insert aynı code path kullanmalı, response format farkı kalkmalı.

---

### C-03 `PATCH /db/:database/:table`

**Kaynak:** PS  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
PATCH /db/mydb/users?where=status.eq.inactive
{"is_active": false}
→ 200 OK
  { "updated": 3 }  ← Yalnızca sayı
```

`where` query param zorunlu — aksi halde 400 döner. `Prefer` header desteklenmiyor.

#### PostgREST'te beklenen davranış

```http
PATCH /mydb/users?status=eq.inactive
{"is_active": false}
→ 204 No Content   ← varsayılan (return=minimal)

# return=representation ile:
PATCH /mydb/users?status=eq.inactive
Prefer: return=representation
{"is_active": false}
→ 200 OK
  [{"id": 1, "status": "inactive", "is_active": false}, ...]
```

PostgREST `where` olmadan tüm tabloyu günceller (istemci sorumludur). Postgrify'ın bunu 400 ile reddetmesi kasıtlı bir güvenlik kararı.

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| `where` zorunluluğu | Evet — where yoksa 400 | Hayır — where yok → full-table update (kasıtlı) |
| Response | `{ updated: N }` | 204 No Content (varsayılan); `return=representation` ile satırlar |
| `Prefer: return` | Okunmuyor | `minimal` (204), `representation` (200 + array) |
| Filter syntax | `?where=col.op.val` | `?col=op.val` (PostgREST shorthand) |

#### Düzeltme notları

- `Prefer: return=representation` desteklenmeli → `RETURNING *`.
- Varsayılan davranış `return=minimal` → 204 No Content, body yok.
- `where` zorunluluğu Postgrify özelinde bir güvenlik tercihi olarak kalabilir ama bu durumda dokümante edilmeli ve `X-Postgrify-Require-Filter: true` header ile istemciye bildirilebilir.
- Response `{ updated: N }` kaldırılmalı — PostgREST davranışıyla uyumlu olması için 204 varsayılan olmalı.

---

### C-04 `DELETE /db/:database/:table`

**Kaynak:** PS  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
DELETE /db/mydb/users?where=status.eq.deleted
→ 200 OK
  { "deleted": 2 }  ← Yalnızca sayı
```

`where` query param zorunlu. `Prefer` header desteklenmiyor.

#### PostgREST'te beklenen davranış

```http
DELETE /mydb/users?status=eq.deleted
→ 204 No Content   ← varsayılan

# return=representation ile:
DELETE /mydb/users?status=eq.deleted
Prefer: return=representation
→ 200 OK
  [{"id": 5, "status": "deleted"}, ...]
```

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| Varsayılan response | 200 + `{ deleted: N }` | 204 No Content |
| `Prefer: return=representation` | Okunmuyor | Silinen satırları döner |
| `where` zorunluluğu | Evet | Hayır (PostgREST full-table delete'e izin verir) |

#### Düzeltme notları

- Varsayılan 204 döndürülmeli (body yok).
- `Prefer: return=representation` → `RETURNING *` sonrası 200 + array.
- `where` koruma mekanizması `X-Postgrify-Require-Filter` header ile opsiyonel yapılabilir.

---

### C-05 `PUT /db/:database/:table/:id`

**Kaynak:** P  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
PUT /db/mydb/users/42
{"name": "Ali Updated"}
→ 200 OK
  { "id": 42, "name": "Ali Updated", ... }
```

Partial update yapıyor (`SET col = val` sadece verilen field'lar için). Bu `PATCH` semantiği.

#### PostgREST'te beklenen davranış

```http
PUT /mydb/users?id=eq.42
{
  "id": 42,
  "name": "Ali Updated",
  "email": "ali@example.com",
  "created_at": "..."
}
→ 200 OK  ← satır varsa güncellendi
→ 201 Created  ← satır yoksa eklendi (upsert)
```

PUT semantiği: tüm satırı replace et (full row upsert). Body'de tüm kolonlar belirtilmeli, belirtilmeyenler NULL olur. Filter ile hedef satır belirlenir.

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| HTTP semantiği | Partial update (PATCH davranışı) | Full row replace + upsert (gerçek PUT) |
| Path | `/:id` path param | `?col=eq.val` query filter |
| Satır yoksa | 404 döner | 201 Created (insert) |
| Tüm kolonlar zorunlu | Hayır | Evet (eksikler NULL olur) |
| `Prefer: return` | Okunmuyor | `representation`, `minimal`, `headers-only` |

#### Düzeltme notları

- Mevcut `PUT /:id` endpoint'i aslında PATCH semantiği uyguluyor. İki seçenek:
  1. PUT'u gerçek replace semantic'e (tüm kolon + upsert) çevir — breaking change
  2. Mevcut davranışı koruyup dokümante et, true PUT'u ayrı endpoint olarak ekle
- `Prefer: return=representation` desteği eklenmeli.
- 404 yerine insert davranışı (upsert) eklenmeli veya seçenek olarak sunulmalı.

---

### C-06 `GET /db/:database/:table/:id`

**Kaynak:** P  
**Dosya:** `packages/api/src/routes/db/rows.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/users/42
→ 200 OK
  { "id": 42, "name": "Ali", "email": "...", ... }  ← SELECT *
```

`select` query param yok — her zaman tüm kolonlar döner.

#### PostgREST'te beklenen davranış

```http
GET /mydb/users?id=eq.42&select=id,name,email
→ 200 OK
  [{"id": 42, "name": "Ali", "email": "..."}]  ← select edilen kolonlar

# Tekil row için (Accept: application/json + limit 1):
# PostgREST'te ayrı /:id path yok — ?col=eq.val&limit=1 pattern'i kullanılır
```

PostgREST'te `/:id` path ayrımı yoktur; tekil satır `?id=eq.42` filtresi ile alınır.

#### Farklar

| Konu | Postgrify (şu an) | PostgREST (beklenen) |
|------|------------------|---------------------|
| `select` query param | Desteklenmez (her zaman SELECT *) | Desteklenir — kolon seçimi, alias, cast |
| Response format | Direkt object | PostgREST'te array (Postgrify object döndürüyor — daha kullanışlı) |
| Path convention | `/:id` path param | `?pk_col=eq.val` query filter |

#### Düzeltme notları

- `select` query param desteği eklenmeli — en az kolon listesi seviyesinde.
- `/:id` path convention Postgrify'a özgü — PostgREST'ten bir sapma ama kullanıcı dostu olduğu için korunabilir.
- Response'un direkt object (array değil) döndürmesi Postgrify tercihi — dokümante edilmeli.

---

## 2. Auth — Login / Refresh / Logout

### C-07 `POST /db/:database/auth/login`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/tokens.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/login
{"email": "user@example.com", "password": "secret"}

→ 200 OK
  {
    "accessToken": "eyJ...",
    "refreshToken": "hex-string",
    "expiresIn": "15m",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "viewer",
      "is_active": true
    }
  }
```

#### Supabase'de beklenen davranış

```http
POST /auth/v1/token?grant_type=password
{"email": "user@example.com", "password": "secret"}

→ 200 OK
  {
    "access_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": 1724440800,
    "refresh_token": "xyzabc",
    "user": {
      "id": "uuid",
      "aud": "authenticated",
      "role": "authenticated",
      "email": "user@example.com",
      "email_confirmed_at": "2026-01-01T00:00:00Z",
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:00:00Z",
      "app_metadata": { "provider": "email", "providers": ["email"] },
      "user_metadata": {}
    }
  }
```

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Field isimleri | camelCase (`accessToken`) | snake_case (`access_token`) |
| `token_type` | Yok | `"bearer"` |
| `expires_in` | String (`"15m"`) | Integer (saniye, örn. `3600`) |
| `expires_at` | Yok | Unix timestamp (integer) |
| `user.role` | Uygulama rolü (`viewer/editor/admin`) | `"authenticated"` (PostgreSQL role) |
| `user.email_confirmed_at` | Yok | ISO datetime veya null |
| `user.created_at` | Yok | ISO datetime |
| `user.updated_at` | Yok | ISO datetime |
| `user.app_metadata` | Yok | `{ provider, providers }` |
| `user.user_metadata` | Yok (`metadata` DB'de var ama response'ta yok) | User-mutable metadata object |
| `user.aud` | Yok | `"authenticated"` |

#### Düzeltme notları

- Response field isimlerini snake_case'e çevir: `access_token`, `refresh_token`, `expires_in`, `expires_at`.
- `token_type: "bearer"` ekle.
- `expires_in` integer saniye cinsinden hesaplanmalı: `parseDuration(config.ACCESS_TOKEN_EXPIRY) / 1000`.
- `expires_at` unix timestamp eklenmeli: `Math.floor(Date.now() / 1000) + expires_in`.
- `user` objesine `email_confirmed_at` (= `email_verified ? created_at : null`), `created_at`, `updated_at`, `app_metadata: { provider, providers: [provider] }` eklenmeli.
- Bu değişiklik `@postgrify/auth-js` SDK'nın `session` parser'ını etkiler — `session.ts` dosyasındaki field isimleri güncellenmeli.

---

### C-08 `POST /db/:database/auth/refresh`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/tokens.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/refresh
{"refreshToken": "hex-string"}

→ 200 OK
  {
    "accessToken": "eyJ...",
    "refreshToken": "new-hex-string",
    "expiresIn": "15m"
  }
```

Eski token `revoked=true` yapılır, yeni token döner. Aynı token iki kez kullanılabilir (reuse detection yok).

#### Supabase'de beklenen davranış

```http
POST /auth/v1/token?grant_type=refresh_token
{"refresh_token": "xyzabc"}

→ 200 OK
  {
    "access_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": 1724444400,
    "refresh_token": "new-token",
    "user": { ... }
  }
```

Supabase reuse detection: aynı token iki kez kullanılırsa tüm token ailesi iptal edilir.
`REFRESH_TOKEN_REUSE_INTERVAL` grace window: eş zamanlı isteklerde kısa pencerede aynı token kabul edilir.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Field isimleri | camelCase | snake_case |
| `token_type` | Yok | `"bearer"` |
| `expires_in` | String | Integer (saniye) |
| `expires_at` | Yok | Unix timestamp |
| `user` objesi | Yok | Login response ile aynı user objesi |
| Reuse detection | Yok — aynı token iki kez kabul edilir | Evet — tüm token ailesi iptal |
| Grace window | Yok | `REFRESH_TOKEN_REUSE_INTERVAL` (varsayılan 10 saniye) |
| `refresh_token` body field | `refreshToken` (camelCase) | `refresh_token` (snake_case) |

#### Düzeltme notları

- Response field isimlerini snake_case'e çevir.
- `user` objesi login response'u ile aynı formatta eklenmeli.
- Reuse detection: `revoked=true` olan token tekrar kullanılmak istenince bu kullanıcının tüm aktif session'ları revoke edilmeli (saldırı sinyali).
- Grace window: `REFRESH_TOKEN_REUSE_INTERVAL` (env var, varsayılan 10 saniye) içinde aynı token bir kez daha kabul edilmeli — eş zamanlı client request'lerine karşı tolerans.
- Request body field: `refreshToken` → `refresh_token` (veya her ikisini de kabul et — backward compat).

---

### C-09 `POST /db/:database/auth/logout`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/tokens.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/logout
{"refreshToken": "hex-string"}

→ 204 No Content
```

Sadece body'deki refresh token revoke edilir. `Authorization` header kullanılmıyor.

#### Supabase'de beklenen davranış

```http
POST /auth/v1/logout?scope=global
Authorization: Bearer <access_token>

→ 204 No Content
```

`scope` seçenekleri:
- `global` — kullanıcının tüm session'larını revoke et
- `local` — sadece bu refresh token'ı revoke et (varsayılan)
- `others` — bu token hariç diğerlerini revoke et

Authorization header üzerinden kimin logout ettiği anlaşılır.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Auth yöntemi | Body'de `refreshToken` | `Authorization: Bearer <access_token>` |
| Scope | Yok — tek token revoke | `global`, `local`, `others` |
| Request field | `refreshToken` (camelCase) | `Authorization` header |
| Hangi session | Body'deki refresh token | Access token'ın sahibinin scope'a göre session(ları) |

#### Düzeltme notları

- `Authorization: Bearer` header'dan kullanıcıyı tanıma seçeneği eklenmeli.
- `scope` query param desteği eklenmeli (`global` tüm session'ları revoke, `local` sadece mevcut).
- Backward compat: body'de `refresh_token` verilirse (eski davranış) da çalışmalı.
- `scope=global` için `jwtService.verifyDbUser()` ile token parse edilip `user_id` üzerinden tüm session'lar revoke edilmeli.

---

## 3. Auth — Signup

### C-10 `POST /db/:database/auth/signup`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/signup.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/signup
{"email": "user@example.com", "password": "secret", "full_name": "Ali"}

→ 201 Created
  {
    "ok": true,
    "email_verify_sent": true,
    "message": "Hesabınız oluşturuldu...",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "email_verified": false,
      "role": "viewer"
    }
  }
```

Email onay gerekmesin dahi token döndürülmüyor. `201` döner.

#### Supabase'de beklenen davranış

```http
POST /auth/v1/signup
{"email": "user@example.com", "password": "secret", "data": {"full_name": "Ali"}}

→ 200 OK
  {
    "access_token": "eyJ...",   ← email_verify_required=false ise token döner
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": 1724440800,
    "refresh_token": "xyzabc",
    "user": {
      "id": "uuid",
      "aud": "authenticated",
      "role": "authenticated",
      "email": "user@example.com",
      "email_confirmed_at": null,  ← verify gerekiyorsa null
      "created_at": "...",
      "updated_at": "...",
      "user_metadata": { "full_name": "Ali" },
      "app_metadata": { "provider": "email", "providers": ["email"] }
    }
  }
```

`email_verify_required=true` ise: aynı response yapısı ama `access_token` boş string, `email_confirmed_at` null.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| HTTP status | 201 | 200 |
| Email onay gerekmiyorsa | Token döndürülmüyor | `access_token` + `refresh_token` döner |
| Email onay gerekiyorsa | `{ ok: true, message }` | Aynı token yapısı ama token boş/null |
| Metadata request field | `full_name` ayrı + `metadata` object | `data` object içinde (`data.full_name`) |
| `user` objesi | Minimal (`id, email, email_verified, role`) | Tam user objesi (Supabase user format) |
| `token_type` | Yok | `"bearer"` |
| `expires_in` / `expires_at` | Yok | Integer saniye + unix timestamp |
| `email_verify_sent` | Evet (Postgrify'a özgü) | Yok (standart değil) |
| `message` | Hardcoded Türkçe | Yok |

#### Düzeltme notları

- HTTP status 201 → 200 (Supabase uyumu).
- `email_verify_required=false` senaryosunda token üretilip response'a eklenmeli.
- `email_verify_required=true` senaryosunda token boş string olarak eklenmeli (Supabase uyumu) veya response shape aynı kalıp `access_token: null` döndürülmeli.
- Response field isimlerini login/refresh ile tutarlı hale getir: `access_token`, `refresh_token`, `expires_in`, `expires_at`, `token_type`.
- Request `data` object desteklenmeli (Supabase SDK uyumu için): `data.full_name` → `full_name` kolonuna.
- `message` ve `email_verify_sent` Postgrify-only field olarak korunabilir ama response başında standart Supabase alanları olmalı.

---

## 4. Auth — Email Verify

### C-11 `GET /db/:database/auth/verify`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/verify.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/auth/verify?token=abc123

→ 200 OK
  {
    "ok": true,
    "accessToken": "eyJ...",
    "refreshToken": "hex...",
    "expiresIn": "15m"
  }
```

Sadece email verification için. `type` parametresi yok. JSON response döner, redirect yok.

#### Supabase'de beklenen davranış

```http
# Email link olarak kullanım (kullanıcı browser'da açar):
GET /auth/v1/verify?token=abc123&type=signup&redirect_to=https://app.com/dashboard
→ 302 Redirect → https://app.com/dashboard#access_token=eyJ...&refresh_token=xyz&type=signup

# SPA flow (POST ile):
POST /auth/v1/verify
{"type": "signup", "token": "abc123", "email": "user@example.com"}
→ 200 OK
  { "access_token": "...", "token_type": "bearer", "expires_in": 3600, ... }
```

`type` değerleri: `signup`, `recovery`, `magiclink`, `invite`, `email_change`, `phone_change`

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| `type` parametresi | Yok (sadece email verify) | Zorunlu — hangi token türü olduğunu belirler |
| Response | JSON `{ ok, accessToken, ... }` | Browser flow: redirect (fragment ile token); SPA flow: JSON |
| `redirect_to` | Yok | Email linkte özel redirect URL |
| Field isimleri | camelCase | snake_case |
| `token_type` | Yok | `"bearer"` |
| `expires_in` / `expires_at` | Yok (sadece `expiresIn: "15m"`) | Integer saniye + unix timestamp |
| `recovery` type | Yok — ayrı endpoint (`/password/reset`) | `type=recovery` ile verify desteklenir |

#### Düzeltme notları

- `type` query param eklenmeli: `signup`, `magiclink`, `recovery`. Her type için ilgili token tablo/field'ı kontrol edilmeli.
- `redirect_to` param desteği eklenmeli: başarıda `302 Redirect → {redirect_to}#{access_token=...&refresh_token=...&type=...}`.
- `redirect_to` yoksa mevcut JSON response davranışı (SPA flow) korunmalı.
- Response field isimlerini snake_case'e çevir.
- `expires_in` integer, `expires_at` unix timestamp eklenmeli.
- `type=recovery` eklenirse `passwordReset.ts` ile ortak logic paylaşılmalı.

---

## 5. Auth — Magic Link

### C-12 `GET /db/:database/auth/magic-link/verify`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/magicLink.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/auth/magic-link/verify?token=abc123

→ 200 OK
  {
    "accessToken": "eyJ...",
    "refreshToken": "hex...",
    "expiresIn": "15m",
    "user": { "id": "uuid", "email": "...", "role": "viewer" }
  }
```

JSON döner, redirect yok. Magic link TTL 15 dakika (hardcoded).

#### Supabase'de beklenen davranış

```http
GET /auth/v1/verify?token=abc123&type=magiclink&redirect_to=https://app.com
→ 302 Redirect → https://app.com#access_token=eyJ...&refresh_token=xyz&type=magiclink

# SPA flow (POST):
POST /auth/v1/verify
{"type": "magiclink", "token": "abc123"}
→ 200 OK + login ile aynı response format
```

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Endpoint | Ayrı `/magic-link/verify` | `GET /verify?type=magiclink` — ortak verify endpoint |
| Response | JSON (camelCase) | Browser: redirect; SPA: JSON (snake_case) |
| `redirect_to` | Yok | Desteklenir |
| Token TTL | 15 dakika (hardcoded) | 1 saat (varsayılan, yapılandırılabilir) |
| `token_type` | Yok | `"bearer"` |
| `expires_in` / `expires_at` | `expiresIn: "15m"` string | Integer saniye + unix timestamp |
| Konsolide verify | Hayır | `type` param ile tüm verify tek endpoint |

#### Düzeltme notları

- `GET /db/:database/auth/verify?type=magiclink` yönlendirmesini `C-11` ile birlikte konsolide et.
- `/magic-link/verify` path'i backward compat için `?type=magiclink` verify'a yönlendirme (301) yapabilir.
- `redirect_to` param desteği eklenmeli.
- TTL auth_settings'ten okunmalı (hardcoded 15 dk yerine `magic_link_ttl` setting key'i).
- Response field isimleri snake_case'e çevrilmeli.
- Magic link TTL ayarı `GET /db/:database/auth/settings` response'una eklenmeli.

---

## 6. Auth — OAuth

### C-13 `GET /db/:database/auth/oauth/:provider/callback`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/oauth.ts`  
**Öncelik:** ⭐⭐⭐

#### Mevcut Postgrify davranışı

```
GET /db/mydb/auth/oauth/google/callback?code=...&state=...
→ 302 Redirect → {APP_URL}/auth/callback#{accessToken=eyJ...&refreshToken=xyz}
```

URL fragment key'leri camelCase: `accessToken`, `refreshToken`.

#### Supabase'de beklenen davranış

```
GET /auth/v1/callback?code=...&state=...
→ 302 Redirect → {redirect_to}#access_token=eyJ...&refresh_token=xyz&token_type=bearer&expires_in=3600&expires_at=...&type=oauth
```

Fragment key'leri snake_case. `token_type`, `expires_in`, `expires_at`, `type=oauth` eklenir.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Fragment key isimleri | camelCase (`accessToken`) | snake_case (`access_token`) |
| `token_type` fragment | Yok | `token_type=bearer` |
| `expires_in` / `expires_at` | Yok | Integer saniye + unix timestamp |
| `type` fragment | Yok | `type=oauth` |
| `redirect_to` | Yok | Initiate endpoint'ten alınan custom URL |

#### Düzeltme notları

- Fragment key'leri snake_case'e çevir: `access_token`, `refresh_token`.
- `token_type=bearer`, `expires_in`, `expires_at`, `type=oauth` fragment'a ekle.
- `@postgrify/auth-js` SDK `session.ts`'deki fragment parser güncellenmeli.
- `redirect_to` parametresi initiate endpoint'ten state'e yazılıp callback'te kullanılmalı (bkz. C-14).

---

### C-14 `GET /db/:database/auth/oauth/:provider`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/oauth.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/auth/oauth/google
→ 302 Redirect → https://accounts.google.com/o/oauth2/auth?...
```

`redirect_to` ve `scopes` query param yok. Callback URL `auth_settings.signup_redirect_url`'den alınır.

#### Supabase'de beklenen davranış

```http
GET /auth/v1/authorize?provider=google&redirect_to=https://app.com/dashboard&scopes=email+profile
→ 302 Redirect → https://accounts.google.com/o/oauth2/auth?scope=email+profile...
```

`redirect_to` state'e yazılır, callback'te bu URL'e yönlendirme yapılır.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| `redirect_to` param | Yok | Desteklenir — her OAuth isteği için özel callback URL |
| `scopes` param | Yok | Ekstra OAuth scope'lar eklenebilir |
| Provider path | `/:provider` path param | `?provider=name` query param (Supabase) |
| Redirect URL | `signup_redirect_url` setting | `redirect_to` param veya setting fallback |

#### Düzeltme notları

- `redirect_to` query param eklenmeli — aynı-origin validation korunmalı (`APP_URL` origin kontrolü).
- `redirect_to` state object'e yazılıp callback'te kullanılmalı.
- `scopes` param: provider auth URL'e eklenmeli; `getAuthUrl()` fonksiyonu scope parametresi almalı.

---

## 7. Auth — Password Reset

### C-15 `POST /db/:database/auth/password/forgot`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/passwordReset.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/password/forgot
{"email": "user@example.com"}

→ 200 OK
  { "ok": true, "message": "Şifre sıfırlama linki email adresinize gönderildi." }
```

Token TTL 1 saat. `redirect_to` yok. Mesaj hardcoded Türkçe.

#### Supabase'de beklenen davranış

```http
POST /auth/v1/recover
{"email": "user@example.com", "redirect_to": "https://app.com/reset-password"}

→ 200 OK
  {}  ← Boş response (güvenlik gereği)
```

Token 24 saat geçerli. `redirect_to` reset email linkine eklenir.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Response | `{ ok: true, message }` | `{}` boş object |
| `message` | Hardcoded Türkçe | Yok |
| `redirect_to` | Yok | Desteklenir — email linki özel URL'ye yönlendirir |
| Token TTL | 1 saat | 24 saat (varsayılan) |

#### Düzeltme notları

- `redirect_to` param desteği eklenmeli: email linkindeki verify URL'e `?redirect_to=...` eklenmeli.
- Token TTL auth_settings'ten okunmalı: `password_reset_ttl` setting key'i (default 24h).
- Response boş object `{}` döndürmek mümkün ama `{ ok: true }` de kabul edilebilir — `message` kaldırılmalı veya opsiyonel hale getirilmeli.
- Hardcoded Türkçe mesaj kaldırılmalı.

---

### C-16 `POST /db/:database/auth/password/reset`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/passwordReset.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
POST /db/mydb/auth/password/reset
{"token": "hex-string", "password": "newpassword"}

→ 200 OK
  { "ok": true, "message": "Şifreniz güncellendi. Lütfen tekrar giriş yapın." }
```

Reset sonrası tüm session'lar revoke edilir. `message` hardcoded Türkçe.

#### Supabase'de beklenen davranış

Supabase'de 2-adımlı flow:
1. `GET /verify?token=xxx&type=recovery` → `access_token` alınır
2. `PUT /user` + `Authorization: Bearer <access_token>` → `{ "password": "newpass" }`

Postgrify'ın tek endpoint'te çözümü daha basit ve fonksiyonel — bu bir tercih farkı.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Flow | Tek endpoint (token + yeni şifre) | 2 adım (verify → token al, PUT /user ile şifre değiştir) |
| Session revoke | Evet (tüm session'lar) | Hayır (kullanıcı seçer) |
| Response | `{ ok: true, message }` | `{}` veya 204 |
| `message` | Hardcoded Türkçe | Yok |
| Token + şifre birlikte | Evet | Hayır (ayrı adımlar) |

#### Düzeltme notları

- Postgrify'ın tek-endpoint yaklaşımı korunabilir (daha basit DX) — bu bilinçli bir tercih olarak dokümante edilmeli.
- `message` hardcoded Türkçe kaldırılmalı — `{ "ok": true }` yeterli.
- Session revoke davranışı `auth_settings.revoke_sessions_on_password_reset` ile toggle edilebilir hale getirilebilir.
- Reset başarısında access token döndürme seçeneği eklenebilir (kullanıcı hemen giriş yapabilsin diye).

---

## 8. Auth — Admin Users ve Settings

### C-17 `GET /db/:database/auth/users`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/users.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/auth/users

→ 200 OK
  {
    "users": [ { "id", "email", "role", "is_active", "created_at", "last_login", "metadata" } ],
    "total": 150
  }
```

Pagination yok — tüm kullanıcıları döner. Filtre yok.

#### Supabase'de beklenen davranış

```http
GET /auth/v1/admin/users?page=1&per_page=50

→ 200 OK
  {
    "users": [ { ... } ],
    "aud": "authenticated",
    "total": 150,
    "next_page": 2,
    "last_page": 3
  }
```

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Pagination | Yok (tüm kullanıcılar) | `page` + `per_page` query param |
| `next_page` / `last_page` | Yok | Response'ta sayfa bilgisi |
| Filtreler | Yok | `email`, `phone`, `created_after`, `created_before` |
| Response wrapper key | `users` | `users` (aynı) |

#### Düzeltme notları

- `page` + `per_page` (veya `limit` + `offset`) pagination eklenmeli.
- `email` (partial match), `role`, `is_active` filtresi eklenmeli.
- `created_after` / `created_before` ISO date filtresi eklenmeli.
- Response'a `next_page`, `last_page`, `page`, `per_page` eklenmeli.
- 10.000+ kullanıcısı olan DB'lerde mevcut tüm-kullanıcı-bir-seferde yaklaşımı ciddi performans sorunu yaratır.

---

### C-18 `PATCH /db/:database/auth/users/:id`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/users.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
PATCH /db/mydb/auth/users/uuid-here
{"role": "editor", "is_active": false, "email": "new@example.com", "full_name": "Ali"}

→ 200 OK
  { "id", "email", "role", "is_active", ... }
```

Güncelleme alanları: `email`, `role`, `is_active`, `full_name`.

#### Supabase'de beklenen davranış

```http
PUT /auth/v1/admin/users/:id
{
  "email": "new@example.com",
  "email_confirm": true,
  "phone": "+905551234567",
  "password": "newpass",
  "user_metadata": {},
  "app_metadata": { "plan": "pro" },
  "role": "authenticated",
  "ban_duration": "24h"
}
```

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| HTTP method | PATCH | PUT (Supabase full replace) |
| `email_confirm` | Yok | Admin olarak email onayını atlama |
| `ban_duration` | Yok (`is_active: false` ile benzer) | `"24h"`, `"72h"`, `"none"` (unban) |
| `metadata` update | Yalnızca `full_name` field | `user_metadata` (user-mutable) + `app_metadata` (admin-only) |
| `password` | Ayrı endpoint (`/reset-password`) | Bu endpoint'te doğrudan değiştirilebilir |

#### Düzeltme notları

- `email_confirm: true` field eklenmeli: verilince `email_verified=true` set eder.
- `ban_duration` field eklenmeli: `"24h"` → `locked_until = now() + duration`; `"none"` → `locked_until = null`.
- `metadata` güncellemesi: `user_metadata` merge (korunan key'ler çıkarılır), `app_metadata` tam replace (admin-only).
- `password` bu endpoint'te de değiştirilebilir olmalı (şifre politikası validate edilerek).

---

### C-19 `POST /db/:database/auth/signup` — Token Davranışı

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/signup.ts`  
**Öncelik:** ⭐⭐⭐

Bu madde C-10'un bir alt başlığıdır ama ayrıca vurgulanması gerekir çünkü **SDK uyumu için kritik**:

#### Sorun

`email_verify_required=false` olduğunda (yani email onayı zorunlu değilken) Postgrify hala token döndürmez.
Supabase'de `mailer_autoconfirm=true` eşdeğeri senaryoda token hemen döner, kullanıcı anında giriş yapar.

Bunun sonucu: `@postgrify/auth-js` SDK'nın `signUp()` metodu, Supabase SDK'dan farklı olarak
kullanıcıyı signup sonrası otomatik login yapamıyor — kullanıcıyı yeniden login sayfasına yönlendirmek gerekiyor.

#### Beklenen davranış

```typescript
// Supabase SDK:
const { data, error } = await supabase.auth.signUp({ email, password })
// email onay gereksizse → data.session mevcut, kullanıcı login

// Postgrify SDK (şu an):
const result = await auth.signUp({ email, password })
// → session yok, kullanıcı login değil, /login sayfasına yönlendirme gerekiyor
```

#### Düzeltme notu

Signup handler'da `email_verify_required=false` ise kullanıcı oluşturulduktan sonra
session üretilip (`createSession()`) response'a eklenmeli. Bu C-10'da zaten belirtildi.

---

### C-20 `GET /db/:database/auth/settings`

**Kaynak:** S  
**Dosya:** `packages/api/src/routes/db/auth/settings.ts`  
**Öncelik:** ⭐⭐

#### Mevcut Postgrify davranışı

```http
GET /db/mydb/auth/settings
Authorization: Bearer <admin-token>  ← admin scope gerekli

→ 200 OK
  {
    "email_signup_enabled": "true",
    "magic_link_enabled": "false",
    "email_verify_required": "false",
    "oauth_enabled": "false",
    "signup_redirect_url": "",
    "token_expiry": "15m",
    "refresh_token_expiry": "7d",
    "default_user_role": "viewer"
  }
```

Tüm değerler string. Admin scope gerekli (public değil).

#### Supabase'de beklenen davranış

```http
GET /auth/v1/settings
# Auth gerekmez — public endpoint

→ 200 OK
  {
    "external": {
      "email": true,
      "google": true,
      "github": false,
      "apple": false,
      ...
    },
    "disable_signup": false,
    "mailer_autoconfirm": false,
    "phone_autoconfirm": false,
    "sms_provider": ""
  }
```

Supabase settings public çünkü frontend'in hangi provider'ların aktif olduğunu bilmesi gerekir.

#### Farklar

| Konu | Postgrify (şu an) | Supabase (beklenen) |
|------|------------------|---------------------|
| Auth | Admin scope zorunlu | Public (auth gereksiz) |
| Response format | Flat key-value string map | Typed nested object |
| Provider listesi | `oauth_enabled: "true/false"` (tek flag) | `external.{provider}: boolean` (provider bazında) |
| Değer tipi | Her şey string (`"true"`, `"false"`) | Typed: boolean, integer, string |
| `disable_signup` | `email_signup_enabled: "false"` | `disable_signup: true` |

#### Düzeltme notları

- Public bir `GET /db/:database/auth/settings` endpoint'i eklenmeli: sadece frontend'in ihtiyaç duyduğu bilgileri döndürür (`external.{provider}`, `disable_signup`, `mailer_autoconfirm`). Admin'e özel ayarlar (token TTL, şifre politikası) bu public endpoint'ten çıkarılmalı.
- Mevcut admin settings endpoint'i korunmalı ama response format:
  - Boolean değerler string yerine `true/false` bool olmalı
  - `external` nested object formatı eklenmeli: `{ google: true, github: false }`
- `disable_signup` alias'ı eklenmeli (`email_signup_enabled` → `disable_signup: !value`).

---

## Özet Tablo

| # | Endpoint | Kaynak | Öncelik | Ana Sorun |
|---|----------|--------|---------|-----------|
| C-01 | `GET /db/:database/:table` | P | ⭐⭐⭐ | Wrapper response, her zaman COUNT, `Content-Range` yok |
| C-02 | `POST /db/:database/:table` | PS | ⭐⭐⭐ | Bulk insert sadece sayı, `Prefer: return` yok, upsert yok |
| C-03 | `PATCH /db/:database/:table` | PS | ⭐⭐⭐ | Response `{updated:N}`, `Prefer: return` yok, 204 olmalı |
| C-04 | `DELETE /db/:database/:table` | PS | ⭐⭐⭐ | Response `{deleted:N}`, `Prefer: return` yok, 204 olmalı |
| C-05 | `PUT /db/:database/:table/:id` | P | ⭐⭐ | Partial update yapıyor (PATCH semantiği), true upsert yok |
| C-06 | `GET /db/:database/:table/:id` | P | ⭐⭐ | `select` param yok, her zaman SELECT * |
| C-07 | `POST /db/:database/auth/login` | S | ⭐⭐⭐ | camelCase field, `expires_at` yok, `token_type` yok, minimal user objesi |
| C-08 | `POST /db/:database/auth/refresh` | S | ⭐⭐⭐ | Reuse detection yok, camelCase, `expires_at` yok, `user` objesi yok |
| C-09 | `POST /db/:database/auth/logout` | S | ⭐⭐ | Body'den token, scope yok, `Authorization` header kullanılmıyor |
| C-10 | `POST /db/:database/auth/signup` | S | ⭐⭐⭐ | 201 yerine 200, email onay yoksa token yok, minimal response |
| C-11 | `GET /db/:database/auth/verify` | S | ⭐⭐⭐ | `type` param yok, redirect yok, camelCase, tek verify endpoint gerekiyor |
| C-12 | `GET /db/:database/auth/magic-link/verify` | S | ⭐⭐⭐ | Redirect yok, 15 dk hardcoded TTL, camelCase, `type` param ile konsolide edilmeli |
| C-13 | `GET /db/:database/auth/oauth/:provider/callback` | S | ⭐⭐⭐ | Fragment key'leri camelCase, `token_type`/`expires_in`/`expires_at` yok |
| C-14 | `GET /db/:database/auth/oauth/:provider` | S | ⭐⭐ | `redirect_to` yok, `scopes` yok |
| C-15 | `POST /db/:database/auth/password/forgot` | S | ⭐⭐ | `redirect_to` yok, 1h TTL (24h olmalı), hardcoded Türkçe mesaj |
| C-16 | `POST /db/:database/auth/password/reset` | S | ⭐⭐ | Hardcoded Türkçe mesaj, session revoke toggle yok |
| C-17 | `GET /db/:database/auth/users` | S | ⭐⭐ | Pagination yok, filtre yok, performans sorunu |
| C-18 | `PATCH /db/:database/auth/users/:id` | S | ⭐⭐ | `email_confirm`, `ban_duration`, `app_metadata` yok |
| C-19 | `POST /db/:database/auth/signup` (token) | S | ⭐⭐⭐ | `email_verify_required=false` iken bile token döndürülmüyor — SDK uyumsuzluğu |
| C-20 | `GET /db/:database/auth/settings` | S | ⭐⭐ | Public endpoint yok, flat string map, provider bazında flag yok |

---

*Toplam düzeltilmesi gereken endpoint: 20*
*⭐⭐⭐ Kritik: 10 · ⭐⭐ Önemli: 10*

> Kaynak: PostgREST v12 ENDPOINT_AUDIT.md (19 endpoint, tümü incelendi) +
> Supabase GoTrue auth-full-endpoint-reference.md (59 endpoint, auth kısmı) +
> Postgrify route kaynak dosyaları (13 dosya okundu)
>
> Cross-check: Postgrify `endpoints.md` — listelenen tüm endpoint'ler gerçekten mevcut ve yanlış çalışıyor.
> Postgrify'a özgü ve iyi çalışan özellikler (JTI blacklist, per-DB OAuth config, session listing API, DB-scoped token) listeye dahil edilmedi.