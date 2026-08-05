# Postgrify — Environment Variables

Bu dosyayı `.env` olarak kopyala ve değerleri doldur:
```
cp exampleenv.md .env   # sonra .env içindeki başlıkları/yorumları sil, sadece KEY=VALUE satırları kalsın
```

---

## Zorunlu Değişkenler

```env
# PostgreSQL bağlantısı
# Docker Compose ile çalışırken:
#   - Docker'daki postgres container'ına bağlanmak için: PG_HOST=postgres
#   - HOST makinedeki (yerel) PostgreSQL'e bağlanmak için: PG_HOST=host.docker.internal
#     (Linux'ta docker-compose.yml'e extra_hosts: host.docker.internal:host-gateway eklenmesi gerekir)
# Local dev (npm run dev) ile çalışırken: PG_HOST=localhost
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=change-me

# JWT imzalama — en az 32 karakter (üretmek için: openssl rand -hex 32)
JWT_SECRET=change-me-must-be-at-least-32-characters-long

# Admin token almak için şifre (üretmek için: openssl rand -base64 24)
ADMIN_SECRET=change-me-admin-secret
```

## Opsiyonel Değişkenler

```env
# PostgreSQL
PG_SSL=false                  # production'da: true

# Connection Pool
PG_MAX_POOL_SIZE=10           # DB başına max bağlantı
PG_POOL_IDLE_TIMEOUT=30000    # ms — idle pool kapanma süresi
PG_POOL_MAX_LIFETIME=3600000  # ms — bağlantı max ömrü (1 saat)

# Auth
JWT_EXPIRY=24h                # Token geçerlilik süresi (1h, 7d, ...)

# DB bazlı secret'lar (yoksa ADMIN_SECRET kullanılır)
# DB_SECRET_PROJECT1=secret-for-project1
# DB_SECRET_PROJECT2=secret-for-project2

# Rate Limiting (dakikada istek)
RATE_LIMIT_GLOBAL=1000        # IP başına
RATE_LIMIT_DB=500             # DB token başına
RATE_LIMIT_ADMIN=200          # Admin token başına

# Redis — yoksa otomatik in-memory LRU cache kullanılır
# REDIS_URL=redis://localhost:6379

# Sunucu
PORT=3000
NODE_ENV=development          # development | production | test
LOG_LEVEL=info                # fatal | error | warn | info | debug | trace
CORS_ORIGINS=http://localhost:5173   # virgülle ayır

# Özellik bayrakları
ALLOW_RAW_SQL_ADMIN=true      # admin token ile DDL dahil tam SQL
QUERY_LOG_ENABLED=false       # sorgu loglama (performans etkisi var)
SLOW_QUERY_THRESHOLD_MS=500   # bu ms'yi aşan sorgular loglanır

# GUI (Vite build-time — sonradan değiştirilemez)
VITE_API_URL=http://localhost:3000
```

## Hazır .env İçeriği (kopyalayıp kullanabilirsin)

```env
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=DEGISTIR
PG_SSL=false
PG_MAX_POOL_SIZE=10
PG_POOL_IDLE_TIMEOUT=30000
PG_POOL_MAX_LIFETIME=3600000
JWT_SECRET=DEGISTIR_EN_AZ_32_KARAKTER_OLMALI_OPENSSL_RAND
ADMIN_SECRET=DEGISTIR_ADMIN_SECRET
JWT_EXPIRY=24h
RATE_LIMIT_GLOBAL=1000
RATE_LIMIT_DB=500
RATE_LIMIT_ADMIN=200
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173
ALLOW_RAW_SQL_ADMIN=true
QUERY_LOG_ENABLED=false
SLOW_QUERY_THRESHOLD_MS=500
VITE_API_URL=http://localhost:3000
```