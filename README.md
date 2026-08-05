# Postgrify

Tek bir PostgreSQL sunucusu üzerinde birden fazla veritabanını tek bir HTTP/REST API üzerinden yöneten servis. Her proje kendi izole veritabanını kullanır; doğrudan PostgreSQL bağlantısı gerekmez.

## Özellikler

- **Çok veritabanı desteği** — tek API, istek başına DB seçimi (URL / header / query param)
- **JWT tabanlı auth** — DB bazlı token (scope ile kısıtlanabilir) + admin token
- **Rate limiting** — global IP, per-DB token, admin katmanları
- **Cache** — Redis (opsiyonel) veya otomatik in-memory LRU fallback
- **Lazy connection pool** — DB başına, kullanılmayanda otomatik kapanır
- **Web GUI** — tablo editörü, şema yönetimi, SQL editörü, API docs
- **OpenAPI 3.1** — Scalar UI ile `/api-docs`

## Hızlı Başlangıç

```bash
# 1. Repoyu klonla
git clone https://github.com/yourname/postgrify
cd postgrify

# 2. Ortam değişkenlerini ayarla
cp packages/.env.example packages/.env
# packages/.env içinde şu üç değeri mutlaka doldur:
#   PG_PASSWORD   — PostgreSQL şifresi
#   JWT_SECRET    — en az 32 karakter  →  openssl rand -hex 32
#   ADMIN_SECRET  — en az 16 karakter  →  openssl rand -base64 18
# Ayrıca POSTGRES_PASSWORD değerini PG_PASSWORD ile aynı yap.

# 3. Başlat
cd packages
docker compose up -d --build
```

Servisler ayağa kalktıktan sonra:

| Servis   | URL                              |
|----------|----------------------------------|
| GUI      | http://localhost:5173            |
| API      | http://localhost:3000            |
| API Docs | http://localhost:3000/api-docs   |

---

## Docker ile Yönetim

### Başlatma

```bash
cd packages

# İlk kurulum veya Dockerfile değiştikten sonra (image yeniden build eder)
docker compose up -d --build

# Sadece durmuş servisleri başlat (build etmez, hızlı)
docker compose up -d

# Tek bir servisi yeniden build edip başlat
docker compose up -d --build api
docker compose up -d --build gui
```

### Durdurma

```bash
# Servisleri durdur, volume'lar korunur (veriler silinmez)
docker compose down

# Servisleri durdur VE volume'ları sil (postgres + redis verileri tamamen silinir)
docker compose down -v
```

### Yeniden Deploy (kod değişikliği sonrası)

```bash
cd packages

# Tüm stack'i yeniden build edip ayağa kaldır
docker compose up -d --build

# Sadece API değiştiyse
docker compose up -d --build api

# Sadece GUI değiştiyse
docker compose up -d --build gui
```

### Loglar

```bash
# Tüm servislerin loglarını canlı takip et
docker compose logs -f

# Sadece API logları
docker compose logs -f api

# Sadece son 50 satır
docker compose logs --tail=50 api
```

### Durum kontrolü

```bash
# Tüm servislerin durumunu gör (Up / healthy / starting)
docker compose ps

# Belirli bir servisin health durumu
docker inspect packages-api-1 --format='{{.State.Health.Status}}'
```

### Temiz yeniden kurulum

```bash
cd packages

# Her şeyi sil: container, image, volume, network
docker compose down -v --rmi all

# Sıfırdan build et ve başlat
docker compose up -d --build
```

## API Kullanımı

### Token alma

```bash
# Admin token
curl -X POST http://localhost:3000/auth/token/admin \
  -H "Content-Type: application/json" \
  -d '{"adminSecret": "your-admin-secret"}'

# DB token (sadece project1'e erişim)
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"database": "project1", "secret": "your-secret", "scope": ["read", "write"]}'
```

### Tablo oluşturma

```bash
curl -X POST http://localhost:3000/db/project1/tables \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "users",
    "columns": [
      { "name": "id", "type": "serial", "primaryKey": true },
      { "name": "name", "type": "text", "nullable": false },
      { "name": "email", "type": "text", "unique": true },
      { "name": "created_at", "type": "timestamptz", "default": "now()" }
    ]
  }'
```

### Satır ekleme

```bash
curl -X POST http://localhost:3000/db/project1/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

### Satır sorgulama

```bash
# Filtreleme + sıralama + sayfalama
curl "http://localhost:3000/db/project1/users?where=name.like.Ali%25&order=created_at.desc&limit=20" \
  -H "Authorization: Bearer <token>"
```

### DB seçim yöntemleri

```bash
# 1. URL prefix (önerilen)
GET /db/project1/users

# 2. Header
GET /db/users
X-Database: project1

# 3. Query param
GET /db/users?database=project1
```

## Yerel Geliştirme (Docker olmadan)

```bash
# API (hot-reload, http://localhost:3000)
cd packages/api
npm install
npm run dev

# GUI (hot-reload, http://localhost:5173)
cd packages/gui
npm install
npm run dev
```

> Yerel geliştirmede `packages/.env` içinde `PG_HOST=localhost` ve `REDIS_URL=redis://localhost:6379` olmalı (Docker Compose'da `PG_HOST=postgres`).

## Ortam Değişkenleri

`exampleenv.md` dosyasına bakın (kopyalayıp `.env` yapın). Zorunlu değişkenler:

| Değişken | Açıklama |
|---|---|
| `PG_PASSWORD` | PostgreSQL şifresi |
| `JWT_SECRET` | En az 32 karakter (token imzalama) |
| `ADMIN_SECRET` | Admin token almak için |

## Lisans

MIT