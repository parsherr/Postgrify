# Postgrify — Eksik Endpoint'ler

> Kaynak analiz: PostgREST (v12) endpoint audit + Supabase GoTrue/Storage API referansı
> Cross-check: Postgrify `endpoints.md` (82 mevcut endpoint)
>
> **Öncelik:** ⭐⭐⭐ Kritik · ⭐⭐ Önemli · ⭐ Nice-to-have
> **Kaynak:** P = PostgREST'te var · S = Supabase'de var · PS = Her ikisinde de var

---

## İçindekiler

1. [PostgREST — Query Engine Eksikleri](#1-postgrest--query-engine-eksikleri)
   - [1.1 HTTP Metodları (HEAD / OPTIONS)](#11-http-metodları-head--options)
   - [1.2 Prefer Header Desteği](#12-prefer-header-desteği)
   - [1.3 RPC (Stored Function) Endpoint'leri](#13-rpc-stored-function-endpointleri)
   - [1.4 Filter Operatör Genişletmeleri](#14-filter-operatör-genişletmeleri)
   - [1.5 Select Parametre Genişletmeleri](#15-select-parametre-genişletmeleri)
   - [1.6 Sayfalama ve Count](#16-sayfalama-ve-count)
   - [1.7 Response Format Seçenekleri](#17-response-format-seçenekleri)
   - [1.8 Diagnostic / Admin Endpoint'leri](#18-diagnostic--admin-endpointleri)
2. [Auth Eksikleri](#2-auth-eksikleri)
   - [2.1 MFA (Multi-Factor Authentication)](#21-mfa-multi-factor-authentication)
   - [2.2 OTP ve Phone Auth](#22-otp-ve-phone-auth)
   - [2.3 PKCE Flow](#23-pkce-flow)
   - [2.4 Admin User Management Genişletmeleri](#24-admin-user-management-genişletmeleri)
   - [2.5 SSO / SAML](#25-sso--saml)
3. [Storage API Eksikleri](#3-storage-api-eksikleri)
   - [3.1 Bucket Yönetimi](#31-bucket-yönetimi)
   - [3.2 Object (Dosya) CRUD](#32-object-dosya-crud)
   - [3.3 Signed URL ve Public Access](#33-signed-url-ve-public-access)
   - [3.4 Resumable Upload (TUS)](#34-resumable-upload-tus)
4. [Schema / DDL Yönetimi Eksikleri](#4-schema--ddl-yönetimi-eksikleri)
   - [4.1 View Yönetimi](#41-view-yönetimi)
   - [4.2 Function/Procedure Yönetimi](#42-functionprocedure-yönetimi)
   - [4.3 Index Yönetimi](#43-index-yönetimi)
   - [4.4 Extension Yönetimi](#44-extension-yönetimi)
   - [4.5 Schema Yönetimi](#45-schema-yönetimi)
   - [4.6 Role Yönetimi](#46-role-yönetimi)
   - [4.7 Publication Yönetimi](#47-publication-yönetimi)
5. [Query Engine Araçları Eksikleri](#5-query-engine-araçları-eksikleri)
6. [Admin / Platform Eksikleri](#6-admin--platform-eksikleri)

---

## 1. PostgREST — Query Engine Eksikleri

PostgREST, her tablo/view için 7 HTTP metod tanımlar ve güçlü bir query language sunar.
Postgrify bu davranışları kendi row CRUD endpoint'lerinde yeniden uygulamalıdır.

---

### 1.1 HTTP Metodları (HEAD / OPTIONS)

#### E-01 · `HEAD /db/:database/:table` ⭐⭐⭐
**Kaynak:** P
**Mevcut Postgrify endpoint:** `GET /db/:database/:table` var, HEAD yok.

HEAD, GET ile birebir aynı SQL sorgusunu çalıştırır ama response body boş döner.
Kullanım amacı: toplam kayıt sayısını (`Content-Range`) veya varlık kontrolünü
body indirmeden yapmak. Ağ tasarrufu kritik frontend uygulamaları için zorunludur.

```http
HEAD /db/mydb/users?status=eq.active
→ 200 OK
   Content-Range: 0-99/1500
   (body yok)
```

**Postgrify'a uyarlama:** `rows.ts`'e HEAD handler eklenir; body yazılmaz,
diğer response header'lar (Content-Range, X-Total-Count) aynen döner.

---

#### E-02 · `OPTIONS /db/:database/:table` ⭐⭐
**Kaynak:** P

CORS preflight ve tablo için desteklenen HTTP metodları (`Allow` header) bilgisini döner.
PostgREST, RLS ve grant'lara göre dinamik `Allow` header üretir.

```http
OPTIONS /db/mydb/products
→ 200 OK
   Allow: GET,HEAD,POST,PATCH,DELETE,OPTIONS
   Access-Control-Allow-Methods: GET,HEAD,POST,PATCH,DELETE,OPTIONS
```

**Postgrify'a uyarlama:** `rows.ts`'e OPTIONS handler; varsayılan olarak tüm
metodları listeler, ileride tablo izin kontrolüyle dinamikleştirilebilir.

---

#### E-03 · `HEAD /db/:database/rpc/:function` ⭐⭐
**Kaynak:** P

RPC endpoint için HEAD — fonksiyon çıktısının metadata'sını (satır sayısı,
content-type) body indirmeden almak için.

---

#### E-04 · `OPTIONS /db/:database/rpc/:function` ⭐⭐
**Kaynak:** P

RPC endpoint için CORS preflight ve `Allow: GET,HEAD,POST,OPTIONS`.

---

### 1.2 Prefer Header Desteği

PostgREST'in en güçlü özelliklerinden biri `Prefer` header ile istemcinin
response davranışını kontrol edebilmesi. Postgrify'da bu header'ların hiçbiri desteklenmiyor.

#### E-05 · `Prefer: return=representation` (POST/PATCH/PUT/DELETE) ⭐⭐⭐
**Kaynak:** PS

Insert/update/delete sonrasında değiştirilen satırları response body'de döndürür.
Şu an Postgrify POST'ta insert sonrası `{ success: true, inserted: n }` gibi sabit
bir yanıt dönüyor; istemci insert edilen ID'yi veya server-side default'ları görmek
için ikinci bir GET yapmak zorunda kalıyor.

```http
POST /db/mydb/users
Prefer: return=representation
Content-Type: application/json

{"name": "Ali", "email": "ali@example.com"}

→ 201 Created
   [{"id": 42, "name": "Ali", "email": "ali@example.com", "created_at": "..."}]
```

**Diğer değerler:**
- `Prefer: return=minimal` — body yok, sadece status (varsayılan olmalı)
- `Prefer: return=headers-only` — body yok, sadece `Location` header

**Postgrify'a uyarlama:** `rows.ts`'de her mutating handler'da `RETURNING *` eklenip
`Prefer` header parse edilir; `return=representation` ise body yazılır.

---

#### E-06 · `Prefer: missing=default` ve `Prefer: missing=null` (POST) ⭐⭐
**Kaynak:** P

Body'de eksik olan alanların nasıl ele alınacağını belirler:
- `missing=default` → DB default değerini kullan (INSERT ederken o kolonu atla)
- `missing=null` → Eksik kolonları NULL olarak set et

```http
POST /db/mydb/products
Prefer: missing=default
{"name": "Widget"}  ← price kolonu yok → DB default fiyat kullanılır
```

---

#### E-07 · `Prefer: resolution=merge-duplicates` ve `resolution=ignore-duplicates` (POST Upsert) ⭐⭐⭐
**Kaynak:** PS

Unique constraint çakışması durumunda davranışı belirler:
- `merge-duplicates` → `ON CONFLICT DO UPDATE` (güncelle)
- `ignore-duplicates` → `ON CONFLICT DO NOTHING` (atla)

Şu an Postgrify'da `PUT /:id` ile tekil upsert var ama `on_conflict` column
belirtilerek toplu upsert (bulk upsert) yok.

```http
POST /db/mydb/users
Prefer: resolution=merge-duplicates
[{"email": "ali@example.com", "name": "Ali v2"}]
← email unique constraint varsa UPDATE yapar
```

**Postgrify'a uyarlama:** `POST /db/:database/:table` handler'da `on_conflict`
query param + `Prefer: resolution=` header parse edilir.

---

#### E-08 · `Prefer: count=exact|planned|estimated` ⭐⭐⭐
**Kaynak:** PS

Sayfalanmış sorgularda toplam kayıt sayısını `Content-Range` header'ında döndürür.

| Değer | Açıklama | Performans |
|-------|----------|-----------|
| `count=exact` | `SELECT COUNT(*)` ek sorgu | Yavaş, doğru |
| `count=planned` | `EXPLAIN` üzerinden planner tahmini | Hızlı, yaklaşık |
| `count=estimated` | Tablo istatistiklerinden anlık tahmin | En hızlı |

```http
GET /db/mydb/orders?status=eq.pending
Prefer: count=exact
→ Content-Range: 0-99/3421
   X-Total-Count: 3421
```

**Postgrify'a uyarlama:** `queryBuilder.ts`'e count mode eklenir; COUNT alt sorgu
opsiyonel olarak çalıştırılır.

---

### 1.3 RPC (Stored Function) Endpoint'leri

PostgreSQL stored function'larını HTTP üzerinden çağırma. PostgREST'in en güçlü
özelliklerinden biri; Postgrify'da **tamamen eksik**.

#### E-09 · `GET /db/:database/rpc/:function` ⭐⭐⭐
**Kaynak:** P

Read-only (STABLE/IMMUTABLE) PostgreSQL fonksiyonlarını HTTP GET ile çağırır.
Fonksiyon parametreleri query string olarak geçirilir.

```http
GET /db/mydb/rpc/get_active_users?min_age=18&role=admin
→ 200 OK
   [{"id": 1, "name": "Ali"}, ...]
```

**Özellikler:**
- Fonksiyon parametreleri URL query param olarak
- `select=` ile sonuçtan kolon seçimi
- `order=`, `limit=`, `offset=` ile sayfalama (SETOF döndüren fonksiyonlar için)
- Response format: JSON veya CSV (`Accept: text/csv`)
- Tek değer dönen fonksiyonlar için otomatik unwrap

**Postgrify'a uyarlama:**
- Yeni route: `routes/db/rpc.ts`
- `GET /db/:database/rpc/:function` ve `POST /db/:database/rpc/:function`
- Auth: `authenticate + dbResolver + scopeGuard("query")`
- SQL: `SELECT * FROM :function(param1 => $1, param2 => $2)`
- Identifier validation: function adı `isValidIdentifier` ile kontrol

---

#### E-10 · `POST /db/:database/rpc/:function` ⭐⭐⭐
**Kaynak:** P

Yan etkili (VOLATILE) veya parametre-ağır fonksiyonları POST ile çağırır.
Parametreler JSON body olarak geçirilir.

```http
POST /db/mydb/rpc/create_order
Content-Type: application/json
{"customer_id": 1, "items": [{"product_id": 5, "qty": 2}]}

→ 200 OK
   {"order_id": 42, "total": 99.90}
```

**Özellikler:**
- `Prefer: return=representation` ile fonksiyon sonucu döner
- `Prefer: params=single-object` → body'yi tek parametre olarak gönderir
- `Prefer: params=multiple-objects` → her array elemanı için ayrı çağrı
- Void dönen fonksiyonlar için `204 No Content`
- Overloaded fonksiyon desteği (parametre sayısına göre seçim)

---

### 1.4 Filter Operatör Genişletmeleri

Postgrify şu an şu filter operatörleri destekliyor: `eq neq gt gte lt lte like ilike in is not`.
Aşağıdakiler **eksik**:

#### E-11 · Full-Text Search Operatörleri ⭐⭐⭐
**Kaynak:** PS

| Operatör | PostgreSQL Fonksiyonu | Açıklama |
|----------|-----------------------|----------|
| `fts` veya `fts(lang)` | `to_tsquery` | Tam kelime FTS |
| `plfts` veya `plfts(lang)` | `plainto_tsquery` | Doğal dil FTS |
| `phfts` veya `phfts(lang)` | `phraseto_tsquery` | Tam cümle FTS |
| `wfts` veya `wfts(lang)` | `websearch_to_tsquery` | Web arama stili FTS |

```http
GET /db/mydb/articles?body=plfts(turkish).yapay+zeka
GET /db/mydb/products?description=wfts.laptop+gaming
```

**Postgrify'a uyarlama:** `queryBuilder.ts`'deki `OPERATORS` map'ine eklenir;
`parsedOp` FTS tipi ise `column @@ to_tsquery($1)` şeklinde SQL üretilir.

---

#### E-12 · Array / Range Operatörleri ⭐⭐
**Kaynak:** P

| Operatör | SQL | Kullanım |
|----------|-----|---------|
| `cs` | `@>` (contains) | `?tags=cs.{coding,go}` |
| `cd` | `<@` (contained by) | `?tags=cd.{a,b,c}` |
| `ov` | `&&` (overlaps) | `?schedule=ov.[2026-01,2026-06]` |
| `sl` | `<<` (strictly left) | `?price_range=sl.(0,100)` |
| `sr` | `>>` (strictly right) | `?price_range=sr.(100,200)` |
| `nxl` | `&>` (no extend left) | `?range=nxl.(1,10)` |
| `nxr` | `&<` (no extend right) | `?range=nxr.(1,10)` |
| `adj` | `-|-` (adjacent) | `?range=adj.(10,20)` |

PostgreSQL array ve range type'ları ile çalışan uygulamalar için zorunlu.

---

#### E-13 · `like(any)` / `like(all)` ve `ilike(any)` / `ilike(all)` Modifier ⭐⭐
**Kaynak:** P

Birden fazla pattern ile OR/AND matching:

```http
GET /db/mydb/users?last_name=like(any).{Smith*,Jones*}
← last_name LIKE 'Smith%' OR last_name LIKE 'Jones%'

GET /db/mydb/products?name=ilike(all).{*premium*,*pro*}
← name ILIKE '%premium%' AND name ILIKE '%pro%'
```

---

#### E-14 · JSON/JSONB Kolon Filtreleme ⭐⭐⭐
**Kaynak:** P

JSONB kolonlar üzerinde arrow operatörleriyle filtreleme:

```http
GET /db/mydb/users?settings->>'theme'=eq.dark
GET /db/mydb/orders?metadata->>'status'=eq.shipped
GET /db/mydb/products?attrs->'specs'->>'weight'=lt.5
```

Postgrify şu an sadece top-level kolon adlarını destekliyor; JSONB path'leri
query param olarak kabul etmiyor.

**Postgrify'a uyarlama:** `queryBuilder.ts`'de kolon adı `->` veya `->>` içeriyorsa
SQL'e doğrudan aktarılır; injection koruması için özel parser gerekir.

---

#### E-15 · `or` / `and` Mantıksal Operatörleri (gelişmiş) ⭐⭐⭐
**Kaynak:** P

Mevcut durum: Postgrify'da `where=field.op.value` formatı var ama logic tree yok.

```http
GET /db/mydb/users?or=(age.lt.18,age.gt.65)
GET /db/mydb/orders?and=(status.eq.pending,total.gt.100)
GET /db/mydb/products?not.and=(price.lt.10,stock.eq.0)

← Nested OR içinde AND:
GET /db/mydb/orders?or=(status.eq.pending,and=(total.gt.100,customer_id.eq.5))
```

**Postgrify'a uyarlama:** `queryBuilder.ts`'de recursive `parseLogicTree` fonksiyonu;
`or=(...)` ve `and=(...)` nested parse edilir.

---

### 1.5 Select Parametre Genişletmeleri

Postgrify `select` param ile kolon listesi alıyor ama aşağıdaki PostgREST özellikleri eksik:

#### E-16 · Embedded Resource (İlişkili Tablo JOIN) ⭐⭐⭐
**Kaynak:** PS

Foreign key ilişkisini otomatik algılayıp JOIN:

```http
GET /db/mydb/orders?select=id,customer:users(name,email),items:order_items(*)
GET /db/mydb/posts?select=*,author:users(name),comments(body,created_at)
```

**Postgrify'a uyarlama:**
- `select` parse edilirken `table(cols)` pattern'i tanınır
- FK bilgisi `information_schema.key_column_usage` / `referential_constraints`'ten çekilir
- Lateral subquery veya JOIN üretilir

---

#### E-17 · Kolon Aliasing ⭐⭐
**Kaynak:** P

```http
GET /db/mydb/users?select=fullName:full_name,joinDate:created_at
```

Response'da `full_name` yerine `fullName` key'i döner.

---

#### E-18 · Type Casting (`::type`) ⭐⭐
**Kaynak:** P

```http
GET /db/mydb/logs?select=id,duration::text,amount::numeric
```

PostgreSQL `CAST` kullanarak kolon tipini dönüştürür.

---

#### E-19 · JSON Alan Çıkarma (select içinde) ⭐⭐
**Kaynak:** P

```http
GET /db/mydb/users?select=id,settings->>'theme',profile->>'bio'
```

JSONB kolondan spesifik alan çekerek flattened response üretir.

---

#### E-20 · Aggregate Fonksiyonlar (`select` içinde) ⭐⭐⭐
**Kaynak:** P

```http
GET /db/mydb/orders?select=status,total:amount.sum(),count:id.count()
GET /db/mydb/products?select=category,avg_price:price.avg()::int
```

Herhangi aggregate-olmayan kolon otomatik `GROUP BY`'a girer.
Desteklenen: `sum()`, `avg()`, `count()`, `max()`, `min()`

---

### 1.6 Sayfalama ve Count

#### E-21 · `Range` Header ile Sayfalama ⭐⭐
**Kaynak:** P

HTTP standart `Range` header kullanarak sayfalama:

```http
GET /db/mydb/products
Range: 0-19
Range-Unit: items
→ Content-Range: 0-19/534
   206 Partial Content
```

Alternatif olarak `limit=20&offset=0` zaten var; bu sadece ek bir sayfalama yöntemi.

---

#### E-22 · `Content-Range` Response Header ⭐⭐⭐
**Kaynak:** PS

Her listeme response'unda sayfa bilgisini döndüren standart header:

```http
GET /db/mydb/users?limit=10&offset=20
→ Content-Range: 20-29/*   ← count istenmediyse * (toplam bilinmiyor)
   Content-Range: 20-29/1500  ← count=exact ile
```

Postgrify şu an sadece `{ data: [...], total: n }` wrapper dönüyor; standart
`Content-Range` header yok. Öne.

---

### 1.7 Response Format Seçenekleri

#### E-23 · `Accept: text/csv` Response Format ⭐⭐
**Kaynak:** P

GET sorgularında JSON yerine CSV formatında response:

```http
GET /db/mydb/users?select=id,name,email
Accept: text/csv
→ id,name,email
   1,Ali,ali@example.com
   2,Veli,veli@example.com
```

Veri export senaryoları için kritik; GUI'den "Export CSV" butonu bu endpoint'e dayanır.

---

#### E-24 · `Accept: application/vnd.pgrst.plan` (Query Plan Debug) ⭐
**Kaynak:** P

```http
GET /db/mydb/users?age=gt.18
Accept: application/vnd.pgrst.plan
→ Seq Scan on users  (cost=0.00..12.50 rows=100 width=32)
     Filter: (age > 18)
```

Production'da kapalı tutulur, development/debug için kullanılır.
Postgrify'da `POST /db/:database/query` ile SQL çalıştırılabiliyor; bu daha basit.

---

### 1.8 Diagnostic / Admin Endpoint'leri

#### E-25 · `GET /ready` (Readiness Probe) ⭐⭐⭐
**Kaynak:** P

Kubernetes/Docker health probe için readiness check. Mevcut `/health` her zaman
200 döner ama `/ready` sadece DB bağlantısı ve hazırlık tamamlandığında 200 döner.

```http
GET /ready
→ 200 OK  ← DB bağlı, hazır
→ 503 Service Unavailable  ← DB bağlantısı yok / başlatılıyor
```

**Postgrify'a uyarlama:** `health.ts`'e `GET /health/ready` eklenir; her kayıtlı
DB pool'una ping atılır, tümü başarılıysa 200.

---

#### E-26 · `GET /metrics` (Prometheus Metrics) ⭐⭐
**Kaynak:** P

Prometheus scrape endpoint'i. Bağlantı havuzu istatistikleri, sorgu süreleri,
hata oranları gibi metrikleri döndürür.

```http
GET /metrics
→ # HELP pgrst_db_pool_available Available connections in the pool
   # TYPE pgrst_db_pool_available gauge
   pgrst_db_pool_available{schema="public"} 8
   pgrst_schema_cache_loads_total 3
```

**Postgrify'a uyarlama:** `admin/metrics.ts`; `prom-client` npm paketi ile
pool stats, request count, error count metriklerini expose eder.

---

#### E-27 · `GET /admin/databases/:db/schema-cache/reload` ⭐⭐
**Kaynak:** P

Schema cache'i yeniden yükler. Tablo yapısı değiştiğinde (migration sonrası)
API'nin yeni şemayı görmesi için kullanılır.

```http
POST /admin/databases/mydb/schema-cache/reload
→ 204 No Content
```

---

## 2. Auth Eksikleri

Postgrify'da per-DB auth sistemi var (GoTrue benzeri). Aşağıdakiler eksik:

---

### 2.1 MFA (Multi-Factor Authentication)

#### E-28 · `POST /db/:database/auth/mfa/enroll` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB user token

MFA factor kayıt başlatır. TOTP (Google Authenticator) veya telefon factor'ı ekler.

```http
POST /db/mydb/auth/mfa/enroll
Authorization: Bearer <db_user_token>
{"factor_type": "totp", "issuer": "MyApp", "friendly_name": "Phone"}

→ 200 OK
   {
     "id": "factor-uuid",
     "type": "totp",
     "totp": {
       "qr_code": "data:image/png;base64,...",
       "secret": "BASE32SECRET",
       "uri": "otpauth://totp/MyApp:user@example.com?secret=..."
     }
   }
```

---

#### E-29 · `POST /db/:database/auth/mfa/challenge` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB user token

Kayıtlı factor için MFA challenge başlatır (TOTP doğrulaması için QR scan yapıldıktan sonra).

```http
POST /db/mydb/auth/mfa/challenge
{"factor_id": "factor-uuid"}

→ {"id": "challenge-uuid", "expires_at": 1234567890}
```

---

#### E-30 · `POST /db/:database/auth/mfa/verify` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB user token

MFA challenge'ı doğrular ve yeni access token döner.

```http
POST /db/mydb/auth/mfa/verify
{
  "factor_id": "factor-uuid",
  "challenge_id": "challenge-uuid",
  "code": "123456"
}

→ {"access_token": "...", "token_type": "bearer", "expires_in": 3600}
```

---

#### E-31 · `GET /db/:database/auth/mfa/factors` ⭐⭐
**Kaynak:** S
**Auth:** DB user token

Kullanıcının kayıtlı MFA factor'larını listeler.

```http
GET /db/mydb/auth/mfa/factors
→ [{"id": "uuid", "type": "totp", "status": "verified", "friendly_name": "Phone"}]
```

---

#### E-32 · `DELETE /db/:database/auth/mfa/factors/:factorId` ⭐⭐
**Kaynak:** S
**Auth:** DB user token veya schema scope

Belirli MFA factor'ı kaldırır.

---

#### E-33 · `POST /db/:database/auth/token?grant_type=mfa` ⭐⭐⭐
**Kaynak:** S
**Auth:** Public (TOTP kodu credential)

MFA doğrulamasından sonra tam erişim token'ı almak için özel grant type.

```http
POST /db/mydb/auth/token?grant_type=mfa
{"factor_id": "uuid", "challenge_id": "uuid", "code": "123456"}
```

---

### 2.2 OTP ve Phone Auth

#### E-34 · `POST /db/:database/auth/otp` ⭐⭐⭐
**Kaynak:** S
**Auth:** Public

Email veya SMS üzerinden OTP (one-time password) gönderir. Magic link'ten farklı
olarak kısa numerik kod gönderir (genellikle 6 haneli).

```http
POST /db/mydb/auth/otp
{"email": "user@example.com"}
← Email'e 6 haneli OTP gönderilir

POST /db/mydb/auth/otp
{"phone": "+905551234567", "channel": "sms"}
← SMS OTP gönderilir
```

**Parametreler:**

| Alan | Tip | Açıklama |
|------|-----|---------|
| `email` | string | Email OTP için |
| `phone` | string | SMS OTP için (E.164 format) |
| `channel` | string | `sms` veya `whatsapp` |
| `create_user` | boolean | Kullanıcı yoksa oluştur (default: true) |

---

#### E-35 · OTP Doğrulama (`verify` endpoint'ine `type=sms/phone_change` eklemek) ⭐⭐⭐
**Kaynak:** S

Mevcut `GET /db/:database/auth/verify?token=` sadece email link doğrulaması yapıyor.
OTP (numerik kod) doğrulaması için POST endpoint gerekli:

```http
POST /db/mydb/auth/verify
{
  "type": "sms",
  "phone": "+905551234567",
  "token": "123456"
}
→ {"access_token": "...", "user": {...}}
```

**type değerleri:** `signup`, `email`, `recovery`, `email_change`, `sms`, `phone_change`, `magiclink`

---

#### E-36 · `POST /db/:database/auth/phone` (Phone Signup/Login) ⭐⭐
**Kaynak:** S
**Auth:** Public

Telefon numarası ile kullanıcı kaydı veya girişi. SMS OTP ile doğrulama yapılır.

```http
POST /db/mydb/auth/phone
{"phone": "+905551234567", "password": "optional_password"}
```

---

### 2.3 PKCE Flow

#### E-37 · `POST /db/:database/auth/token?grant_type=pkce` ⭐⭐⭐
**Kaynak:** S
**Auth:** Public

PKCE (Proof Key for Code Exchange) flow'u için authorization code'u access token'a
exchange eder. OAuth/Magic link flow'larında mobil ve SPA uygulamaları için güvenli.

```http
POST /db/mydb/auth/token?grant_type=pkce
{"auth_code": "...", "code_verifier": "..."}

→ {"access_token": "...", "refresh_token": "...", "user": {...}}
```

PKCE flow şu an `/db/:database/auth/magic-link` ve `/db/:database/auth/oauth` ile
başlatılabiliyor ama code exchange endpoint'i yok.

---

### 2.4 Admin User Management Genişletmeleri

#### E-38 · `GET /db/:database/auth/admin/users/:id` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Tek kullanıcının tüm detaylarını döner (identities, MFA factors, sessions dahil).

```http
GET /db/mydb/auth/admin/users/uuid-here
→ {
    "id": "uuid",
    "email": "...",
    "phone": "...",
    "role": "authenticated",
    "identities": [...],
    "factors": [...],
    "created_at": "..."
  }
```

Mevcut `GET /db/:database/auth/users` tüm kullanıcıları listeler ama tekil detay yok.

---

#### E-39 · `POST /db/:database/auth/admin/generate-link` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Admin olarak email link (doğrulama, şifre sıfırlama, magic link) üretir.
Email göndermeden direkt link döner — custom email sistemi entegrasyonu için.

```http
POST /db/mydb/auth/admin/generate-link
{
  "type": "magiclink",
  "email": "user@example.com",
  "redirect_to": "https://myapp.com/dashboard"
}

→ {
    "action_link": "https://myapp.com/auth/verify?token=abc&type=magiclink",
    "email_otp": "123456",
    "hashed_token": "...",
    "expires_at": 1234567890
  }
```

**type değerleri:** `signup`, `magiclink`, `recovery`, `email_change`, `phone_change`

---

#### E-40 · `GET /db/:database/auth/admin/users` — Gelişmiş Filtreler ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema/read)

Mevcut `GET /db/:database/auth/users` var ama Supabase'deki filtre parametreleri eksik:

| Parametre | Açıklama |
|-----------|---------|
| `email` | Email'e göre filtrele |
| `phone` | Telefona göre filtrele |
| `page` | Sayfa numarası |
| `per_page` | Sayfa başına kullanıcı |
| `created_after` | Bu tarihten sonra oluşturulanlar |
| `created_before` | Bu tarihten önce oluşturulanlar |

---

#### E-41 · `POST /db/:database/auth/admin/users/:id/ban` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Kullanıcıyı belirli süre veya süresiz ban/unban eder. Ban edilen kullanıcı
yeni token alamaz, mevcut session'ları geçersiz kalır.

```http
POST /db/mydb/auth/admin/users/uuid/ban
{"ban_duration": "24h"}  ← "none" ile unban

→ {"id": "uuid", "banned_until": "2026-08-13T00:00:00Z"}
```

---

### 2.5 SSO / SAML

#### E-42 · `GET /db/:database/auth/sso/providers` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

SAML 2.0 SSO provider'larını listeler.

---

#### E-43 · `POST /db/:database/auth/sso/providers` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni SSO (SAML 2.0) provider ekler.

---

#### E-44 · `GET /db/:database/auth/saml/metadata` ⭐
**Kaynak:** S
**Auth:** Public

SAML SP metadata XML döner. Identity provider konfigürasyonu için.

---

## 3. Storage API Eksikleri

Postgrify'da dosya yükleme (`/db/:database/:table/:column/upload`) var ama bu bir
tablo kolonu için inline binary yükleme. Supabase tarzı **ayrı Storage API** (bucket
bazlı dosya yönetimi) tamamen eksik.

---

### 3.1 Bucket Yönetimi

#### E-45 · `GET /db/:database/storage/buckets` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

```http
GET /db/mydb/storage/buckets
→ [{"id": "avatars", "name": "avatars", "public": false, "file_size_limit": 5242880}]
```

---

#### E-46 · `POST /db/:database/storage/buckets` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

```http
POST /db/mydb/storage/buckets
{
  "id": "avatars",
  "name": "avatars",
  "public": false,
  "file_size_limit": 5242880,
  "allowed_mime_types": ["image/png", "image/jpeg", "image/webp"]
}
→ {"name": "avatars"}
```

---

#### E-47 · `GET /db/:database/storage/buckets/:id` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Belirli bucket detayı.

---

#### E-48 · `PUT /db/:database/storage/buckets/:id` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Bucket güncelle (public/private, size limit, MIME tipi kısıtları).

---

#### E-49 · `DELETE /db/:database/storage/buckets/:id` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Bucket sil (önce boşaltılmış olmalı).

---

#### E-50 · `POST /db/:database/storage/buckets/:id/empty` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Bucket içindeki tüm nesneleri sil (bucket'ı kaldırmaz).

---

### 3.2 Object (Dosya) CRUD

#### E-51 · `POST /db/:database/storage/object/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:write)

Dosya yükle. Multipart veya binary body.

```http
POST /db/mydb/storage/object/avatars/user123/avatar.png
Content-Type: image/png
x-upsert: false
<binary data>

→ {"Id": "avatars/user123/avatar.png", "Key": "avatars/user123/avatar.png"}
```

---

#### E-52 · `PUT /db/:database/storage/object/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:write)

Var olan dosyayı güncelle (upsert — üzerine yaz).

---

#### E-53 · `GET /db/:database/storage/object/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:read) veya signed URL

Dosyayı indir. Image transformation query param'ları desteklenir:

| Parametre | Açıklama |
|-----------|---------|
| `width` | Genişlik (px) |
| `height` | Yükseklik (px) |
| `quality` | Kalite 20-100 |
| `format` | `origin`, `avif`, `webp` |
| `resize` | `cover`, `contain`, `fill` |

---

#### E-54 · `GET /db/:database/storage/object/info/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:read)

Dosyayı indirmeden metadata bilgisi döner (boyut, MIME tipi, ETag, son güncelleme).

---

#### E-55 · `DELETE /db/:database/storage/object/:bucket` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:delete)

Tek veya çoklu dosya sil.

```http
DELETE /db/mydb/storage/object/avatars
{"prefixes": ["user123/avatar.png", "user456/photo.jpg"]}
```

---

#### E-56 · `POST /db/:database/storage/object/move` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:write)

Dosyayı taşı veya yeniden adlandır (aynı veya farklı bucket).

```http
POST /db/mydb/storage/object/move
{
  "bucketId": "avatars",
  "sourceKey": "tmp/upload.png",
  "destinationBucket": "avatars",
  "destinationKey": "user123/avatar.png"
}
```

---

#### E-57 · `POST /db/:database/storage/object/copy` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:write)

Dosyayı kopyala (orijinal yerinde kalır).

---

#### E-58 · `POST /db/:database/storage/object/list/:bucket` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:read)

Bucket içindeki dosyaları listele. Klasör bazlı gezinme desteği:

```http
POST /db/mydb/storage/object/list/avatars
{"prefix": "user123/", "limit": 100, "offset": 0, "sortBy": {"column": "name", "order": "asc"}}
→ [{"name": "avatar.png", "id": "uuid", "metadata": {...}}]
```

---

### 3.3 Signed URL ve Public Access

#### E-59 · `POST /db/:database/storage/object/sign/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:read)

Private bucket dosyaları için zaman sınırlı signed URL üretir.

```http
POST /db/mydb/storage/object/sign/avatars/user123/avatar.png
{"expiresIn": 3600}
→ {"signedURL": "/db/mydb/storage/object/sign/avatars/...?token=abc"}
```

---

#### E-60 · `GET /db/:database/storage/object/sign/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** Signed URL token (query param)

Signed URL ile dosyaya eriş (token expire olana kadar auth gerektirmez).

---

#### E-61 · `POST /db/:database/storage/object/sign/:bucket` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:read)

Birden fazla dosya için tek seferde signed URL üret.

```http
POST /db/mydb/storage/object/sign/avatars
{
  "paths": ["user1/avatar.png", "user2/photo.jpg"],
  "expiresIn": 3600
}
```

---

#### E-62 · `GET /db/:database/storage/object/public/:bucket/*path` ⭐⭐⭐
**Kaynak:** S
**Auth:** Public (sadece public bucket'lar için)

Public olarak işaretlenmiş bucket'taki dosyaya auth olmadan eriş.
CDN cache-friendly URL'ler için kullanılır.

---

### 3.4 Resumable Upload (TUS)

#### E-63 · `POST /db/:database/storage/upload/resumable` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:write)

TUS protokolü ile büyük dosyalar için resumable upload başlatır.
6MB üzeri dosyalar için önerilen yöntem.

```http
POST /db/mydb/storage/upload/resumable
Upload-Length: 104857600
Upload-Metadata: bucketName avatars, objectName user/file.mp4
Content-Type: application/offset+octet-stream

→ 201 Created
   Location: /db/mydb/storage/upload/resumable/upload-id
```

---

## 4. Schema / DDL Yönetimi Eksikleri

Postgrify'da `GET /db/:database/tables` ve tablo CRUD var ama kapsamlı schema yönetimi eksik.

---

### 4.1 View Yönetimi

#### E-64 · `GET /db/:database/views` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Veritabanındaki tüm view'ları ve materialized view'ları listeler.

```http
GET /db/mydb/views
→ [{"name": "active_users", "schema": "public", "is_updatable": true, "definition": "SELECT ..."}]
```

---

#### E-65 · `POST /db/:database/views` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni view oluşturur.

```http
POST /db/mydb/views
{"name": "active_users", "schema": "public", "query": "SELECT * FROM users WHERE is_active = true"}
```

---

#### E-66 · `GET /db/:database/views/:view` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

View detayı (definition, kolonlar, bağımlılıklar).

---

#### E-67 · `DELETE /db/:database/views/:view` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

View sil.

---

### 4.2 Function/Procedure Yönetimi

#### E-68 · `GET /db/:database/functions` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Veritabanındaki tüm stored function'ları listeler.

```http
GET /db/mydb/functions
→ [{"name": "get_active_users", "schema": "public", "language": "plpgsql", "return_type": "SETOF users"}]
```

---

#### E-69 · `POST /db/:database/functions` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni function oluşturur.

---

#### E-70 · `GET /db/:database/functions/:func` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Function detayı (parametre tipleri, return type, source code).

---

#### E-71 · `PATCH /db/:database/functions/:func` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Function güncelle (source veya konfigürasyon değiştir).

---

#### E-72 · `DELETE /db/:database/functions/:func` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Function sil.

---

### 4.3 Index Yönetimi

#### E-73 · `GET /db/:database/indexes` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Tüm index'leri listeler (tablo, tip, kolonlar, boyut, kullanım istatistikleri).

```http
GET /db/mydb/indexes
→ [{"name": "users_email_idx", "table": "users", "columns": ["email"], "type": "btree", "size": "128 kB"}]
```

---

#### E-74 · `POST /db/:database/indexes` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni index oluşturur (`CREATE INDEX` veya `CREATE UNIQUE INDEX`).

```http
POST /db/mydb/indexes
{
  "table": "users",
  "name": "users_email_idx",
  "columns": ["email"],
  "type": "btree",
  "unique": true
}
```

---

#### E-75 · `DELETE /db/:database/indexes/:index` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Index sil (`DROP INDEX`).

---

### 4.4 Extension Yönetimi

#### E-76 · `GET /db/:database/extensions` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yüklü ve yüklenebilir tüm PostgreSQL extension'larını listeler.

```http
GET /db/mydb/extensions
→ [
    {"name": "pgvector", "installed_version": "0.7.0", "default_version": "0.7.0", "installed": true},
    {"name": "pg_trgm", "installed_version": null, "default_version": "1.6", "installed": false}
  ]
```

---

#### E-77 · `POST /db/:database/extensions` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Extension etkinleştir (`CREATE EXTENSION IF NOT EXISTS`).

---

#### E-78 · `DELETE /db/:database/extensions/:ext` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Extension devre dışı bırak (`DROP EXTENSION`).

---

### 4.5 Schema Yönetimi

#### E-79 · `GET /db/:database/schemas` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Veritabanındaki tüm schema'ları listeler.

```http
GET /db/mydb/schemas
→ [{"name": "public", "owner": "postgres"}, {"name": "api", "owner": "api_user"}]
```

---

#### E-80 · `POST /db/:database/schemas` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni schema oluşturur.

---

#### E-81 · `PATCH /db/:database/schemas/:schema` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Schema adını değiştir veya owner'ı güncelle.

---

### 4.6 Role Yönetimi

#### E-82 · `GET /db/:database/roles` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

PostgreSQL rol listesi (system roller hariç uygulama rolleri).

```http
GET /db/mydb/roles
→ [{"name": "web_anon", "is_superuser": false, "can_login": false, "member_of": []}]
```

---

#### E-83 · `POST /db/:database/roles` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Yeni PostgreSQL rolü oluşturur.

---

#### E-84 · `DELETE /db/:database/roles/:role` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Rol sil.

---

### 4.7 Publication Yönetimi

#### E-85 · `GET /db/:database/publications` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

PostgreSQL logical replication publication'larını listeler. Realtime özelliği için kullanılır.

---

#### E-86 · `PATCH /db/:database/publications/:pub` ⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Publication'a tablo ekle veya çıkar.

---

## 5. Query Engine Araçları Eksikleri

#### E-87 · `POST /db/:database/query/explain` ⭐⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:query)

`EXPLAIN ANALYZE` çalıştırır ve görselleştirilebilir format döner.
Mevcut `POST /db/:database/query` raw SQL çalıştırıyor; bu endpoint `EXPLAIN` çıktısını
parse ederek yapılandırılmış JSON döner (GUI'de query plan görselleştirme için).

```http
POST /db/mydb/query/explain
{"sql": "SELECT * FROM orders WHERE status = 'pending'", "analyze": true, "buffers": true}

→ {
    "Plan": {
      "Node Type": "Seq Scan",
      "Relation Name": "orders",
      "Actual Rows": 1500,
      "Actual Total Time": 12.34,
      ...
    }
  }
```

---

#### E-88 · `POST /db/:database/migrations` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

SQL migration çalıştırır ve migration history kaydeder.

```http
POST /db/mydb/migrations
{
  "name": "add_phone_to_users",
  "sql": "ALTER TABLE users ADD COLUMN phone VARCHAR(20);"
}
→ {"id": 5, "name": "add_phone_to_users", "applied_at": "2026-08-12T..."}
```

---

#### E-89 · `GET /db/:database/migrations` ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Uygulanan migration geçmişini listeler.

---

#### E-90 · `PATCH /db/:database/tables/:table` (Tablo Rename/Move) ⭐⭐
**Kaynak:** S
**Auth:** DB token (scope:schema)

Mevcut `DELETE /db/:database/tables/:table` var. Rename ve schema değiştirme eksik:

```http
PATCH /db/mydb/tables/users
{"name": "app_users", "schema": "app"}
← ALTER TABLE public.users RENAME TO app_users;
   ALTER TABLE app_users SET SCHEMA app;
```

---

## 6. Admin / Platform Eksikleri

#### E-91 · `GET /admin/databases/:db/logs` ⭐⭐⭐
**Kaynak:** S
**Auth:** Admin token

PostgreSQL query logları ve error loglarını API üzerinden sorgular.

```http
GET /admin/databases/mydb/logs?level=error&limit=100&from=2026-08-12T00:00:00Z
→ [{"timestamp": "...", "level": "ERROR", "message": "...", "query": "..."}]
```

---

#### E-92 · `GET /admin/databases/:db/connections` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

Aktif DB bağlantılarını listeler (`pg_stat_activity` benzeri).

```http
GET /admin/databases/mydb/connections
→ [{"pid": 1234, "state": "active", "query": "SELECT ...", "duration_ms": 120}]
```

---

#### E-93 · `DELETE /admin/databases/:db/connections` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

Tüm veya belirli aktif bağlantıları sonlandırır (`pg_terminate_backend`).

```http
DELETE /admin/databases/mydb/connections
{"except_pid": 1234}  ← bu pid hariç tümünü kes
```

---

#### E-94 · `GET /admin/databases/:db/usage` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

DB seviyesi kullanım metrikleri (disk boyutu, bağlantı sayısı, tablo boyutları).

```http
GET /admin/databases/mydb/usage
→ {
    "db_size": "1.2 GB",
    "active_connections": 12,
    "tables": [{"name": "orders", "size": "450 MB", "row_count": 2500000}]
  }
```

---

#### E-95 · `POST /admin/databases/:db/clone` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

Var olan DB'yi yeni bir DB olarak kopyalar (şema + veri).

```http
POST /admin/databases/mydb/clone
{"name": "mydb_staging"}
→ {"id": "mydb_staging", "status": "cloning"}
```

---

#### E-96 · `GET /admin/databases/:db/settings` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

DB seviyesi konfigürasyon ayarları (connection pool boyutu, log level, timeout'lar).

---

#### E-97 · `PATCH /admin/databases/:db/settings` ⭐⭐
**Kaynak:** S
**Auth:** Admin token

DB seviyesi ayarları günceller.

---

---

## Özet Tablo

| # | Endpoint | Kaynak | Öncelik |
|---|----------|--------|---------|
| E-01 | `HEAD /db/:database/:table` | P | ⭐⭐⭐ |
| E-02 | `OPTIONS /db/:database/:table` | P | ⭐⭐ |
| E-03 | `HEAD /db/:database/rpc/:function` | P | ⭐⭐ |
| E-04 | `OPTIONS /db/:database/rpc/:function` | P | ⭐⭐ |
| E-05 | `Prefer: return=representation/minimal/headers-only` (POST/PATCH/PUT/DELETE) | PS | ⭐⭐⭐ |
| E-06 | `Prefer: missing=default/null` (POST) | P | ⭐⭐ |
| E-07 | `Prefer: resolution=merge-duplicates/ignore-duplicates` (POST Upsert) | PS | ⭐⭐⭐ |
| E-08 | `Prefer: count=exact/planned/estimated` | PS | ⭐⭐⭐ |
| E-09 | `GET /db/:database/rpc/:function` | P | ⭐⭐⭐ |
| E-10 | `POST /db/:database/rpc/:function` | P | ⭐⭐⭐ |
| E-11 | FTS operatörleri (`fts`, `plfts`, `phfts`, `wfts`) | PS | ⭐⭐⭐ |
| E-12 | Array/Range operatörleri (`cs`, `cd`, `ov`, `sl`, `sr`, `nxl`, `nxr`, `adj`) | P | ⭐⭐ |
| E-13 | `like(any)` / `like(all)` modifier | P | ⭐⭐ |
| E-14 | JSON/JSONB kolon filtreleme (`col->>'key'=eq.val`) | P | ⭐⭐⭐ |
| E-15 | `or` / `and` / `not.and` nested logic tree | P | ⭐⭐⭐ |
| E-16 | Embedded resource / FK-based JOIN (`select=table(cols)`) | PS | ⭐⭐⭐ |
| E-17 | Kolon aliasing (`alias:col`) | P | ⭐⭐ |
| E-18 | Type casting (`col::type`) | P | ⭐⭐ |
| E-19 | JSON alan çıkarma select içinde (`col->>'key'`) | P | ⭐⭐ |
| E-20 | Aggregate fonksiyonlar (`col.sum()`, `col.avg()`, vb.) | P | ⭐⭐⭐ |
| E-21 | `Range` header ile sayfalama | P | ⭐⭐ |
| E-22 | `Content-Range` response header | PS | ⭐⭐⭐ |
| E-23 | `Accept: text/csv` response format | P | ⭐⭐ |
| E-24 | `Accept: application/vnd.pgrst.plan` (query plan debug) | P | ⭐ |
| E-25 | `GET /health/ready` (readiness probe) | P | ⭐⭐⭐ |
| E-26 | `GET /metrics` (Prometheus) | P | ⭐⭐ |
| E-27 | `POST /admin/databases/:db/schema-cache/reload` | P | ⭐⭐ |
| E-28 | `POST /db/:database/auth/mfa/enroll` | S | ⭐⭐⭐ |
| E-29 | `POST /db/:database/auth/mfa/challenge` | S | ⭐⭐⭐ |
| E-30 | `POST /db/:database/auth/mfa/verify` | S | ⭐⭐⭐ |
| E-31 | `GET /db/:database/auth/mfa/factors` | S | ⭐⭐ |
| E-32 | `DELETE /db/:database/auth/mfa/factors/:factorId` | S | ⭐⭐ |
| E-33 | `POST /db/:database/auth/token?grant_type=mfa` | S | ⭐⭐⭐ |
| E-34 | `POST /db/:database/auth/otp` (Email/SMS OTP) | S | ⭐⭐⭐ |
| E-35 | `POST /db/:database/auth/verify` (OTP numerik kod) | S | ⭐⭐⭐ |
| E-36 | `POST /db/:database/auth/phone` (Phone signup) | S | ⭐⭐ |
| E-37 | `POST /db/:database/auth/token?grant_type=pkce` | S | ⭐⭐⭐ |
| E-38 | `GET /db/:database/auth/admin/users/:id` | S | ⭐⭐⭐ |
| E-39 | `POST /db/:database/auth/admin/generate-link` | S | ⭐⭐⭐ |
| E-40 | Gelişmiş kullanıcı listesi filtreleri | S | ⭐⭐ |
| E-41 | `POST /db/:database/auth/admin/users/:id/ban` | S | ⭐⭐ |
| E-42 | `GET /db/:database/auth/sso/providers` | S | ⭐ |
| E-43 | `POST /db/:database/auth/sso/providers` | S | ⭐ |
| E-44 | `GET /db/:database/auth/saml/metadata` | S | ⭐ |
| E-45 | `GET /db/:database/storage/buckets` | S | ⭐⭐⭐ |
| E-46 | `POST /db/:database/storage/buckets` | S | ⭐⭐⭐ |
| E-47 | `GET /db/:database/storage/buckets/:id` | S | ⭐⭐⭐ |
| E-48 | `PUT /db/:database/storage/buckets/:id` | S | ⭐⭐⭐ |
| E-49 | `DELETE /db/:database/storage/buckets/:id` | S | ⭐⭐⭐ |
| E-50 | `POST /db/:database/storage/buckets/:id/empty` | S | ⭐⭐ |
| E-51 | `POST /db/:database/storage/object/:bucket/*path` | S | ⭐⭐⭐ |
| E-52 | `PUT /db/:database/storage/object/:bucket/*path` | S | ⭐⭐⭐ |
| E-53 | `GET /db/:database/storage/object/:bucket/*path` | S | ⭐⭐⭐ |
| E-54 | `GET /db/:database/storage/object/info/:bucket/*path` | S | ⭐⭐⭐ |
| E-55 | `DELETE /db/:database/storage/object/:bucket` | S | ⭐⭐⭐ |
| E-56 | `POST /db/:database/storage/object/move` | S | ⭐⭐⭐ |
| E-57 | `POST /db/:database/storage/object/copy` | S | ⭐⭐ |
| E-58 | `POST /db/:database/storage/object/list/:bucket` | S | ⭐⭐⭐ |
| E-59 | `POST /db/:database/storage/object/sign/:bucket/*path` | S | ⭐⭐⭐ |
| E-60 | `GET /db/:database/storage/object/sign/:bucket/*path` | S | ⭐⭐⭐ |
| E-61 | `POST /db/:database/storage/object/sign/:bucket` (çoklu) | S | ⭐⭐ |
| E-62 | `GET /db/:database/storage/object/public/:bucket/*path` | S | ⭐⭐⭐ |
| E-63 | `POST /db/:database/storage/upload/resumable` (TUS) | S | ⭐⭐ |
| E-64 | `GET /db/:database/views` | S | ⭐⭐⭐ |
| E-65 | `POST /db/:database/views` | S | ⭐⭐ |
| E-66 | `GET /db/:database/views/:view` | S | ⭐⭐ |
| E-67 | `DELETE /db/:database/views/:view` | S | ⭐⭐ |
| E-68 | `GET /db/:database/functions` | S | ⭐⭐⭐ |
| E-69 | `POST /db/:database/functions` | S | ⭐⭐ |
| E-70 | `GET /db/:database/functions/:func` | S | ⭐⭐ |
| E-71 | `PATCH /db/:database/functions/:func` | S | ⭐⭐ |
| E-72 | `DELETE /db/:database/functions/:func` | S | ⭐⭐ |
| E-73 | `GET /db/:database/indexes` | S | ⭐⭐⭐ |
| E-74 | `POST /db/:database/indexes` | S | ⭐⭐ |
| E-75 | `DELETE /db/:database/indexes/:index` | S | ⭐⭐ |
| E-76 | `GET /db/:database/extensions` | S | ⭐⭐ |
| E-77 | `POST /db/:database/extensions` | S | ⭐⭐ |
| E-78 | `DELETE /db/:database/extensions/:ext` | S | ⭐⭐ |
| E-79 | `GET /db/:database/schemas` | S | ⭐⭐⭐ |
| E-80 | `POST /db/:database/schemas` | S | ⭐⭐ |
| E-81 | `PATCH /db/:database/schemas/:schema` | S | ⭐ |
| E-82 | `GET /db/:database/roles` | S | ⭐⭐ |
| E-83 | `POST /db/:database/roles` | S | ⭐ |
| E-84 | `DELETE /db/:database/roles/:role` | S | ⭐ |
| E-85 | `GET /db/:database/publications` | S | ⭐ |
| E-86 | `PATCH /db/:database/publications/:pub` | S | ⭐ |
| E-87 | `POST /db/:database/query/explain` | S | ⭐⭐⭐ |
| E-88 | `POST /db/:database/migrations` | S | ⭐⭐ |
| E-89 | `GET /db/:database/migrations` | S | ⭐⭐ |
| E-90 | `PATCH /db/:database/tables/:table` (rename/move) | S | ⭐⭐ |
| E-91 | `GET /admin/databases/:db/logs` | S | ⭐⭐⭐ |
| E-92 | `GET /admin/databases/:db/connections` | S | ⭐⭐ |
| E-93 | `DELETE /admin/databases/:db/connections` | S | ⭐⭐ |
| E-94 | `GET /admin/databases/:db/usage` | S | ⭐⭐ |
| E-95 | `POST /admin/databases/:db/clone` | S | ⭐⭐ |
| E-96 | `GET /admin/databases/:db/settings` | S | ⭐⭐ |
| E-97 | `PATCH /admin/databases/:db/settings` | S | ⭐⭐ |

---

*Toplam eksik endpoint: 97*
*⭐⭐⭐ Kritik: 36 · ⭐⭐ Önemli: 46 · ⭐ Nice-to-have: 15*

> Kaynak: PostgREST v12 ENDPOINT_AUDIT.md (19 endpoint, tümü incelendi) +
> Supabase GoTrue API 59 endpoint + Supabase Storage API 99 endpoint
> Cross-check: Postgrify endpoints.md (82 mevcut endpoint)