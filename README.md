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
cp exampleenv.md .env
# .env içindeki başlık/yorum satırlarını sil, sadece KEY=VALUE satırları kalsın
# PG_PASSWORD, JWT_SECRET, ADMIN_SECRET değerlerini doldur

# 3. Başlat
docker compose up -d

# API: http://localhost:3000
# GUI: http://localhost:80
# API Docs: http://localhost:3000/api-docs
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

## Geliştirme

```bash
# API (hot-reload)
cd packages/api
npm install
npm run dev

# GUI (hot-reload)
cd packages/gui
npm install
npm run dev
```

## Ortam Değişkenleri

`exampleenv.md` dosyasına bakın (kopyalayıp `.env` yapın). Zorunlu değişkenler:

| Değişken | Açıklama |
|---|---|
| `PG_PASSWORD` | PostgreSQL şifresi |
| `JWT_SECRET` | En az 32 karakter (token imzalama) |
| `ADMIN_SECRET` | Admin token almak için |

## Lisans

MIT