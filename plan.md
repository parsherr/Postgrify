# Postgrify — Geliştirme Planı

## Vizyon

Tek bir PostgreSQL sunucusu üzerinde çalışan, birden fazla veritabanını tek bir HTTP/REST
API üzerinden yöneten bir servis. Her proje kendi veritabanını kullanır; tablolar ve veriler
tamamen izoledir. Projeler doğrudan PostgreSQL'e bağlanmak yerine Postgrify API'si üzerinden
erişir.

---

## Mimari Genel Bakış

```
[Client / Proje]
      │
      ▼
[Postgrify API — Fastify]
      │
      ├── DB Resolver (URL prefix / Header / Query param)
      ├── Auth (JWT)
      ├── Rate Limiter
      ├── Cache (Redis)
      │
      ▼
[Pool Manager]
      │
      ├── Pool: project1 ──► PostgreSQL DB: project1
      ├── Pool: project2 ──► PostgreSQL DB: project2
      └── Pool: project3 ──► PostgreSQL DB: project3
```

---

## Stack

| Katman        | Teknoloji              | Neden                                                   |
|---------------|------------------------|---------------------------------------------------------|
| Runtime       | Node.js + TypeScript   | Hızlı geliştirme, tip güvenliği, geniş ekosistem       |
| Framework     | Fastify                | Düşük overhead, plugin sistemi, schema validation       |
| DB Driver     | postgres.js            | En hızlı Node PG driver, native connection pool         |
| Auth          | jose (JWT)             | Stateless, her DB için farklı claim/scope               |
| Rate Limiting | @fastify/rate-limit    | Redis veya in-memory, plugin tabanlı                    |
| Cache         | Redis + ioredis        | Query cache, rate limit store, schema cache             |
| GUI           | React + Vite           | SPA, aynı monorepo                                      |
| UI Bileşen    | shadcn/ui + Tailwind   | Accessible, headless, özelleştirilebilir                |
| State/Data    | TanStack Query         | Server state, cache, refetch                            |
| API Docs      | Scalar                 | OpenAPI 3.1 üzerinden otomatik, modern UI               |
| Container     | Docker Compose         | API + GUI + Redis + PG tek compose ile ayağa kalkar     |

---

## Routing Stratejisi

Üç yöntem aynı anda desteklenir. Öncelik sırası:

```
1. URL prefix   →  POST /db/project1/tables/users
2. HTTP Header  →  X-Database: project1
3. Query param  →  POST /tables/users?database=project1
```

DB Resolver middleware, her request'te bu sırayla kontrol eder ve `request.dbName`'i set eder.
Bulunamazsa 400 döner.

---

## API Endpoint Referansı

### Admin (admin JWT gerekir)

```
GET    /admin/databases              — Tüm DB'ler: isim, boyut, tablo sayısı
POST   /admin/databases              — Yeni DB oluştur  { name }
DELETE /admin/databases/:db          — DB sil (cascade)
GET    /admin/stats                  — Servis geneli istatistik
GET    /health                       — Health check (auth yok)
```

### Auth

```
POST   /auth/token                   — DB bazlı JWT al  { database, secret }
POST   /auth/token/admin             — Admin JWT al     { adminSecret }
POST   /auth/token/refresh           — Token yenile
```

### Tablo İşlemleri  (DB token veya admin gerekir)

```
GET    /db/:database/tables                  — Tabloları listele (şema dahil)
POST   /db/:database/tables                  — Tablo oluştur
DELETE /db/:database/tables/:table           — Tablo sil
GET    /db/:database/tables/:table/schema    — Tablo şeması (kolon, tip, index)
PATCH  /db/:database/tables/:table/schema    — Kolon ekle / düzenle / sil
```

### Row İşlemleri

```
GET    /db/:database/:table          — Satır listele
                                       ?select=col1,col2
                                       ?where=age.gt.18
                                       ?order=name.asc
                                       ?limit=50&offset=0
POST   /db/:database/:table          — Satır ekle (tekil veya dizi)
PATCH  /db/:database/:table          — Toplu güncelle (?where=...)
DELETE /db/:database/:table          — Toplu sil    (?where=...)
GET    /db/:database/:table/:id      — Tekil satır (primary key ile)
PUT    /db/:database/:table/:id      — Satır güncelle
DELETE /db/:database/:table/:id      — Satır sil
```

### Sorgu & Metadata

```
POST   /db/:database/query           — Ham SQL (varsayılan: sadece SELECT)
GET    /db/:database/size            — DB disk boyutu
GET    /db/:database/stats           — Tablo bazlı satır sayısı + boyut
```

---

## Filtreleme Sözdizimi (Query DSL)

`?where=` parametresi nokta-notasyonu ile çalışır:

```
age.gt.18          →  age > 18
name.eq.alice      →  name = 'alice'
name.like.ali%     →  name LIKE 'ali%'
status.in.a,b,c    →  status IN ('a','b','c')
score.gte.90       →  score >= 90
score.lte.100      →  score <= 100
field.is.null      →  field IS NULL
field.not.null     →  field IS NOT NULL
```

Operatörler: `eq` `neq` `gt` `gte` `lt` `lte` `like` `ilike` `in` `is` `not`

Birden fazla where koşulu için tekrar edilebilir:
`?where=age.gt.18&where=status.eq.active`

---

## Auth Modeli

### Token Tipleri

| Tip          | Kapsam                         | Claim Örneği                              |
|--------------|--------------------------------|-------------------------------------------|
| Admin token  | Tüm DB'ler, tam yetki          | `{ role: "admin" }`                       |
| DB token     | Tek DB, scope ile kısıtlanır   | `{ sub: "project1", scope: ["read","write"] }` |

### Scope'lar

- `read`   — GET istekleri
- `write`  — POST, PUT, PATCH
- `delete` — DELETE
- `schema` — Tablo oluştur/sil, şema değiştir
- `query`  — Ham SQL çalıştır

### Token Üretimi

Her DB'nin `.env`'de tanımlı bir `secret`'i vardır (veya admin panelinden oluşturulur).
Token almak için:

```json
POST /auth/token
{ "database": "project1", "secret": "my-secret", "scope": ["read", "write"] }
```

---

## Connection Pool Stratejisi

Her veritabanı için **lazy pool**: ilk istek gelince açılır, idle timeout'ta kapatılır.

```
PG_MAX_POOL_SIZE      = 10     (DB başına max bağlantı)
PG_POOL_IDLE_TIMEOUT  = 30000  (ms, idle'da kapat)
PG_POOL_MAX_LIFETIME  = 3600000 (ms, bağlantı max ömrü)
```

Pool Manager singleton olarak çalışır. `getPool(dbName)` çağrısı varsa mevcut pool'u döner,
yoksa yeni oluşturur. `releasePool(dbName)` ile manuel kapatılabilir.

---

## Cache Stratejisi

| Veri              | TTL     | Invalidasyon                         |
|-------------------|---------|--------------------------------------|
| Row GET sorgusu   | 30 sn   | Aynı tabloya yazma işleminde         |
| Tablo şeması      | 5 dk    | Schema değiştiğinde                  |
| DB boyut/istatistik | 1 dk  | Zaman tabanlı, süre dolunca          |
| Tablo listesi     | 2 dk    | Tablo eklenince / silinince          |

Cache anahtarı formatı: `postgrify:{dbName}:{table}:{queryHash}`

Redis yoksa in-memory LRU cache (node-lru-cache) otomatik devreye girer.

---

## Rate Limiting

| Kapsam         | Limit           |
|----------------|-----------------|
| Global (IP)    | 1000 req/dk     |
| DB token       | 500 req/dk      |
| Admin token    | 200 req/dk      |
| /auth/token    | 20 req/dk (IP)  |

Aşımda `429 Too Many Requests` + `Retry-After` header döner.

---

## Güvenlik

### SQL Injection Koruması
- Tüm değerler parametrik sorgularla gönderilir (`$1, $2, ...`)
- Dinamik tablo/kolon adları identifier regex ile validate edilir
- Geçerli identifier: `/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/`

### Ham SQL Güvenliği
- Varsayılan: yalnızca `SELECT` ifadelerine izin verilir
- `query` scope'u olan token ile açılır
- Admin token ile tam SQL (DDL dahil) çalışır
- Tehlikeli keyword'ler blocklist ile filtrelenir

### DB İzolasyonu
- Her DB token yalnızca kendi DB'sine erişebilir
- Middleware, `request.dbName` ile token'daki `sub` claim'ini karşılaştırır
- Admin token tüm DB'lere erişebilir

### CORS & Headers
- Konfigüre edilebilir CORS origin listesi
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

---

## GUI Ekranları

```
/                          — Dashboard
                             • Aktif DB sayısı, toplam boyut
                             • Son 24 saat istek grafiği
                             • Son sorgular

/databases                 — DB Listesi
                             • Her DB: isim, boyut, tablo sayısı, son erişim
                             • Yeni DB oluştur
                             • DB sil (onay modalı)

/databases/:db             — DB Detay
                             • Tablo listesi (boyut, satır sayısı)
                             • DB boyut grafiği
                             • Yeni tablo oluştur

/databases/:db/tables/:table  — Tablo Editörü
                             • Veri grid (sayfalama, sıralama, filtreleme)
                             • Satır ekle / düzenle / sil
                             • Şema görüntüle / düzenle
                             • CSV export

/api-keys                  — Token Yönetimi
                             • DB bazlı token üret
                             • Scope seçimi
                             • Token kopyala / iptal et

/query                     — SQL Editörü
                             • DB seç, SQL yaz, çalıştır
                             • Sonucu tablo olarak göster
                             • Sorgu geçmişi

/api-docs                  — Scalar API Dokümantasyonu
                             • Otomatik OpenAPI 3.1
                             • Try-it-out

/logs                      — Sorgu Logları
                             • DB, tablo, süre, durum filtresi
                             • Yavaş sorgu uyarısı (>500ms)
```

---

## Geliştirme Milestone'ları

### M1 — Çekirdek API

- [ ] Fastify kurulumu, TypeScript config
- [ ] Pool Manager (lazy, per-DB, postgres.js)
- [ ] DB Resolver middleware (URL / header / param)
- [ ] CRUD endpoint'leri (GET, POST, PUT, PATCH, DELETE)
- [ ] Temel filtreleme / sıralama / sayfalama
- [ ] Ham sorgu endpoint'i (SELECT only)
- [ ] Identifier validation

### M2 — Auth & Güvenlik

- [ ] JWT üretim ve doğrulama (jose)
- [ ] Admin token vs DB token ayrımı
- [ ] Scope middleware
- [ ] Rate limiting (in-memory önce, Redis sonra)
- [ ] CORS ve güvenlik header'ları
- [ ] SQL injection koruması (parametre + blocklist)

### M3 — Tablo Yönetimi & Şema

- [ ] Tablo oluşturma (JSON → DDL)
- [ ] Tablo silme
- [ ] Şema sorgulama
- [ ] Kolon ekleme / düzenleme / silme

### M4 — Cache & Metadata

- [ ] Redis bağlantısı + in-memory fallback
- [ ] Query cache (GET endpoint'leri)
- [ ] Schema cache
- [ ] DB boyut endpoint'i
- [ ] Tablo istatistik endpoint'i
- [ ] Cache invalidasyon mekanizması

### M5 — GUI

- [ ] React + Vite + shadcn/ui kurulum
- [ ] TanStack Query entegrasyonu
- [ ] Dashboard
- [ ] DB listesi + yönetimi
- [ ] Tablo editörü (veri grid)
- [ ] Şema editörü
- [ ] SQL editörü
- [ ] Token yönetimi
- [ ] Sorgu logları
- [ ] Scalar API docs embed

### M6 — Production Hazırlığı

- [ ] Docker Compose (API + GUI + Redis + PG)
- [ ] Environment variable dokümantasyonu
- [ ] Health check endpoint'i
- [ ] Graceful shutdown (pool kapatma)
- [ ] Sorgu loglama (isteğe bağlı, konfigüre edilebilir)
- [ ] README

---

## Environment Variables

```env
# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=secret
PG_SSL=false

# Pool
PG_MAX_POOL_SIZE=10
PG_POOL_IDLE_TIMEOUT=30000
PG_POOL_MAX_LIFETIME=3600000

# Auth
JWT_SECRET=change-me-in-production
ADMIN_SECRET=admin-secret-change-me
JWT_EXPIRY=24h

# Rate Limit
RATE_LIMIT_GLOBAL=1000
RATE_LIMIT_DB=500
RATE_LIMIT_ADMIN=200

# Redis (opsiyonel — yoksa in-memory cache kullanılır)
REDIS_URL=redis://localhost:6379

# API
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173

# GUI
VITE_API_URL=http://localhost:3000
```

---

## Klasör Yapısı (özet)

```
postgrify/
├── packages/
│   ├── api/              Fastify API servisi
│   └── gui/              React + Vite GUI
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── plan.md               (bu dosya)
└── README.md
```

Detaylı yapı için `docs/architecture.md` dosyasına bakın.

---

## Kritik Kararlar & Gerekçeler

**Neden PostgREST değil?**
PostgREST tek bir DB ile çalışır. Her DB için ayrı instance çalıştırmak zorunda kalırsın.
Tek endpoint'ten çoklu DB yönlendirmesi mümkün değil. Postgrify bu boşluğu doldurur.

**Neden per-DB lazy pool?**
Tüm DB'ler için başlangıçta pool açmak, aktif olmayan DB'ler için kaynak israfı yaratır.
Lazy pool, kullanılan DB'ler için bağlantı tutar, kullanılmayanlar serbest bırakılır.

**Neden Fastify?**
Express'e kıyasla ~2x daha hızlı, built-in JSON schema validation, plugin sistemi
predictable ve test edilmesi kolay.

**Neden Redis opsiyonel?**
Küçük kurulumlar için Redis zorunlu kılmak overhead yaratır. In-memory LRU fallback ile
Redis olmadan da çalışır; production'da Redis önerilir.