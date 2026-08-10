# Active Work — 2026-08-10

## Durum
Tüm görevler tamamlandı. 797/797 unit test + 33/33 entegrasyon testi geçiyor.

## Tamamlanan Düzeltmeler (bu session)

### API Bug Fixes
- **SORUN #H**: `query.ts` preHandler'a `authenticateAny` eklendi → editor DB user token artık /query'ye erişebiliyor
- **SORUN #8**: `DELETE /db/:database/auth/me` zaten `users.ts`'de mevcuttu (önceki sessionda hatalı rapor)
- **metadata JSONB bug**: `me.ts` PATCH handler'da `|| $1::JSONB` yerine `|| $1::text::jsonb` kullanıldı — postgres.js bind sorununu çözüyor
- **metadata scalar bug**: `GET /me` ve `GET /auth/users` + `PATCH /me` RETURNING'de `CASE WHEN jsonb_typeof(metadata)='object'` ile bozuk (array) metadata güvenli hale getirildi
- **PATCH WHERE duplicate bug**: PATCH RETURNING kısmına hatayla eklenen ikinci `WHERE id = $1` kaldırıldı
- **provision.ts**: `AuditEvent` tipine `"account_deleted"` eklendi

### Test Dosyaları
- `test/routes/me-delete.test.ts` — 4 test, `authUsersRoute` kullanıyor, 200/401/403 beklentileri doğru
- `test/routes/me-get-metadata.test.ts` — 5 test
- `test/routes/me-patch.test.ts` — 10 test
- `test/routes/rows-pagination.test.ts` — 5 test
- `test/routes/query-db-user.test.ts` — 5 test

### Tweeter-Clone Test Scripti
- `packages/test/tweeter-clone/config.mjs` — düzeltildi
- `packages/test/tweeter-clone/setup.mjs` — idempotent, `default:` (değil `defaultValue:`), auth user cleanup
- `packages/test/tweeter-clone/app.mjs` — 10 bölüm, 33 test, 33/33 geçiyor

## Keşfedilen API Tasarım Notları
- `POST /auth/token`: body `{ database, secret, scope? }` — Bearer token gerektirmez
- `POST /admin/databases`: `{ name }` — sadece isim yeterli, host/port gerekmiyor
- `DELETE /db/:db/auth/me`: 200 `{ ok: true, message }` döner (204 değil)
- Admin token `POST /auth/token/admin` response: `{ token, role: "admin" }` — expiresIn yok
- `POST /db/:db/:table` response: `{ inserted: [{ ...row }] }` — `inserted[0].id` ile id alınır
- Tablo CREATE: API `default:` alanını bekler, `defaultValue:` değil
- `X-API-Key`: per-DB auth endpoints (signup/login) Bearer token olmadan X-API-Key zorunlu

## Next
- Gerektiğinde `database-issues.md` güncelle
- Varsa yeni kullanıcı istekleri