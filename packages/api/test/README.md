# API Test Suite

## Çalıştırma

```bash
cd packages/api
npm install

# Tek seferlik çalıştır
npm test

# Watch modu (geliştirme)
npm run test:watch

# Coverage raporu (htmlde açılır)
npm run test:coverage
```

## Test Dosyaları

```
test/
├── setup.ts                              — Global env override (PG, JWT, vb.)
├── README.md                             — Bu dosya
│
├── services/
│   ├── jwtService.test.ts               — sign/verify, expiry, wrong secret
│   ├── queryBuilder.test.ts             — WHERE/SELECT/ORDER SQL üretimi
│   ├── cacheService.test.ts             — set/get/del/invalidatePattern (LRU)
│   └── poolManager.test.ts              — lazy init, same pool, closeAll
│
├── utils/
│   ├── identifier.test.ts               — regex validate, reserved words
│   └── asyncHandler.test.ts             — hata → HTTP status eşleşmesi
│
├── middleware/
│   ├── dbResolver.test.ts               — URL/header/param öncelik, 400 case
│   └── scopeGuard.test.ts               — admin bypass, wrong scope, wrong DB
│
└── routes/
    ├── health.test.ts                   — GET /health
    ├── auth.test.ts                     — POST /auth/token, /auth/token/admin
    ├── admin.test.ts                    — GET|POST /admin/databases
    ├── tables.test.ts                   — GET|POST|DELETE /db/:db/tables
    ├── rows.test.ts                     — GET|POST /db/:db/:table
    └── query.test.ts                    — POST /db/:db/query (SELECT-only mod)
```

## Notlar

- Gerçek **PostgreSQL veya Redis bağlantısı gerekmez** — mock'lanır
- `postgres.js` ve `CacheService` her route testinde `vi.mock()` ile stub'lanır
- Fastify, her test dosyasında gerçek instance olarak ayağa kalkar (`server.inject`)
- `test/setup.ts` tüm testlerden önce env değişkenlerini test değerleriyle set eder
- Coverage hedefi: services + utils %80+, routes %60+