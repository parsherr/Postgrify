# Postgrify — Mimari Dokümantasyonu

## Genel Bakış

```
[Client]
   │  HTTP + JWT
   ▼
[Fastify API :3000]
   │
   ├─ plugins/cors         — CORS header'ları
   ├─ plugins/rateLimit    — IP ve token bazlı hız sınırı
   ├─ plugins/auth         — JWT doğrulama, decorator'lar
   ├─ plugins/cache        — Redis / in-memory LRU
   ├─ plugins/pool         — DB pool manager
   ├─ plugins/openApi      — Swagger + Scalar UI
   │
   ├─ routes/health        — GET /health (auth yok)
   ├─ routes/auth          — POST /auth/token, /auth/token/admin
   ├─ routes/admin         — GET|POST|DELETE /admin/databases, /admin/stats
   └─ routes/db            — /db/:database/* (tablo + row + query + meta)
         │
         ├─ middleware/dbResolver    — DB adını belirle (URL/header/param)
         ├─ middleware/scopeGuard    — Token scope kontrolü
         │
         └─ services/poolManager    — postgres.js lazy pool, DB başına
```

## Request Yaşam Döngüsü

```
1. CORS check
2. Rate limit check (IP bazlı global)
3. Auth (Bearer JWT doğrulama)  →  request.user set edilir
4. DB Resolver                  →  request.dbName set edilir
5. Scope Guard                  →  token.sub === dbName && scope içeriyor mu?
6. Route Handler
   a. Cache hit? → direkt dön
   b. Pool.getPool(dbName) → postgres.js sql nesnesi al
   c. Sorguyu çalıştır (parametrik)
   d. Cache'e yaz (write işlemlerinde invalidate et)
   e. Yanıtı dön
```

## Connection Pool Akışı

```
İlk istek: getPool("project1")
  └─ Pool yok → yeni postgres.js Sql oluştur → pool map'e kaydet

Sonraki istekler: getPool("project1")
  └─ Pool var → lastUsed güncelle → mevcut pool'u dön

Her 60 saniye: evictIdlePools()
  └─ (now - lastUsed) > IDLE_TIMEOUT olan pool'ları kapat

Shutdown: closeAll()
  └─ Tüm pool'lara sql.end() → graceful drain
```

## Cache Anahtarı Formatı

```
postgrify:{dbName}:tables                    — tablo listesi
postgrify:{dbName}:schema:{tableName}        — tablo şeması
postgrify:{dbName}:rows:{tableName}:{hash}   — satır sorgusu (SHA1 10 char)
postgrify:{dbName}:size                      — DB boyutu
postgrify:{dbName}:stats                     — tablo istatistikleri
```

Yazma işlemlerinde `invalidatePattern("postgrify:{dbName}:rows:{table}:*")` çağrılır.

## JWT Payload Yapısı

```jsonc
// DB token
{
  "sub": "project1",           // hedef DB adı
  "role": "db",
  "scope": ["read", "write"],  // izin verilen işlemler
  "iat": 1234567890,
  "exp": 1234654290
}

// Admin token
{
  "role": "admin",             // sub yok — tüm DB'lere erişim
  "iat": 1234567890,
  "exp": 1234654290
}
```

## Güvenlik Katmanları

| Katman | Koruduğu |
|---|---|
| DB Resolver | Geçersiz DB adı (regex validate) |
| Scope Guard | Token yalnızca kendi DB'sine erişir; scope kontrolü |
| Parametrik sorgular | SQL injection (postgres.js tagged template) |
| Identifier validate | Tablo/kolon adı injection (`assertIdentifier`) |
| SELECT-only mod | Yetkisiz DDL/DML (`/db/:db/query`) |
| Rate limiting | Brute-force, DoS |
| Keyword blocklist | Ham SQL'de DROP/TRUNCATE/DELETE vb. |

## Klasör Sorumluluğu

| Klasör | Sorumluluk |
|---|---|
| `config/` | Env parse + tip güvenliği (Zod) |
| `plugins/` | Fastify yaşam döngüsüne entegre servisler |
| `middleware/` | Birden fazla route'da paylaşılan preHandler'lar |
| `services/` | İş mantığı — framework bağımsız, test edilebilir |
| `routes/` | HTTP katmanı — thin controller |
| `utils/` | Saf yardımcı fonksiyonlar, yan etkisiz |
| `types/` | Ortak TypeScript tipler |