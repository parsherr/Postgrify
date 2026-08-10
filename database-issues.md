# Postgrify API & SDK — Gerçek Dünya Test Raporu
## Proje: Twitter Clone (tweeter-clone)

**Amaç:** Postgrify REST API ve `@postgrify/auth-js` SDK'sı kullanarak bir Twitter klonu
oluşturarak gerçek dünya kullanım senaryolarında hangi eksikliklerin ve sorunların
ortaya çıktığını belgelemek.

**Test ortamı:** `packages/test/tweeter-clone/`
**Test tarihi:** 2026-08-10
**API versiyonu:** v0.3.0
**Test yöntemi:** Kaynak kodun doğrudan incelenmesi + tam çalışan uygulama yazılması

---

## Mimari

Twitter klonu için seçilen tablolar:
- `users` — kullanıcı profilleri (bio, avatar_url, username, display_name, auth_id)
- `tweets` — tweetler (content, image_url, user_id, created_at, reply_to)
- `follows` — takip ilişkileri (follower_id, following_id)
- `likes` — beğeniler (user_id, tweet_id)

Auth için `@postgrify/auth-js` SDK ve per-DB auth sistemi kullanıldı.

---

## SORUNLAR VE EKSİKLİKLER

---

### SORUN #1 — POST /tables: Foreign Key Desteği Yok

**Ne yapmaya çalıştım:**
HTTP API ile tablo oluştururken `REFERENCES users(id) ON DELETE CASCADE` gibi FK
kısıtları tanımlamak istedim.

**Bulgular (`routes/db/tables.ts`):**
`POST /db/:database/tables` endpoint'i mevcut ve `schema` scope gerekiyor — bu iyi.
Ama body'nin `columns` array'i sadece şunları destekliyor:
`name, type, nullable, primaryKey, unique, default`.
`references` veya `foreignKey` alanı yok.

**Geçici çözüm:** Tablolar oluşturulduktan sonra admin token ile `/query` endpoint'ine
`ALTER TABLE ... ADD CONSTRAINT` SQL'i gönderildi. Ama bu SORUN #15 ile çakışıyor.

**Beklenen davranış:**
```json
{
  "name": "user_id",
  "type": "uuid",
  "references": { "table": "users", "column": "id", "onDelete": "CASCADE" }
}
```

---

### SORUN #2 — Görsel Yükleme (File Upload) Desteği Yok

**Ne yapmaya çalıştım:**
Tweet'lere görsel eklemek için binary dosya yükleme özelliği planladım.

**Bulgular:**
Postgrify'da medya/storage endpoint'i yok. `routes/db/upload.ts` var ama CSV/veri
yükleme içindir — medya dosyaları için değil.

**Geçici çözüm:** Görseller URL string olarak `image_url` kolonuna kaydedildi.
Kullanıcı harici CDN'de barındırılan bir URL giriyor.

**Etki:** Tweet görsel paylaşma özelliği Postgrify built-in kapasitesiyle yapılamıyor;
harici depolama şart. Bu kapsam dışı olabilir ama hiçbir yerde belgelenmiyor.

---

### SORUN #3 — Rows Endpoint: Subquery Desteği Yok

**Ne yapmaya çalıştım:**
`GET /db/twitter/rows/tweets?where=user_id.in.(SELECT id FROM follows WHERE follower_id=X)`
şeklinde subquery ile filtreleme yapmak istedim.

**Bulgular (`services/queryBuilder.ts`):**
`in` operatörü literal değer listesi bekliyor (`field.in.val1,val2,val3`).
Subquery yazılamıyor — tasarım gereği güvenli, ama sosyal ağ senaryolarında kısıtlayıcı.

**Etki:** Timeline özelliği için `/query` endpoint'ine ham SQL şart.
Ham SQL ayrı scope gereklilikleri getiriyor (bkz. SORUN #11).

---

### SORUN #4 — Rows Endpoint: JOIN Desteği Yok

**Ne yapmaya çalıştım:**
Tweetleri kullanıcı bilgileriyle (username, display_name, avatar_url) birlikte tek
bir istekte almak istedim.

**Bulgular:**
`GET /db/:database/rows/:table` tek tablo üzerinde çalışıyor; JOIN parametresi yok.
Multi-table sorgu için `/query` endpoint'ine ham SQL zorunlu.

**Etki:** Tweet listesi göstermek için ya N+1 request ya da `/query` ile ham SQL.
`/query` query scope gerektiriyor (bkz. SORUN #11).

---

### SORUN #5 — Auth SDK: getUser() Her Çağrıda Network Request Yapıyor

**Bulgular:**
`PostgrifyAuth.getUser()` her çağrıda `/me` endpoint'ine HTTP request gönderiyor,
client-side cache yok. React gibi sık render eden ortamlarda her component render'ında
network request oluşuyor.

**Önerilen çözüm:** `getCachedUser()` metodu veya session'dan direkt okuma.

---

### SORUN #6 — Signup: Custom Alan Yok, Çok Adımlı Kayıt Gerekiyor

**Ne yapmaya çalıştım:**
Signup'ta `username`, `display_name`, `bio` alanları göndermek istedim.

**Bulgular:**
`POST /db/:database/auth/signup` sadece `{ email, password, full_name? }` alıyor.
`username` gibi uygulama-specific alanlar için destek yok.

**Geçici çözüm — üç adımlı kayıt:**
1. `POST /auth/signup` — auth user oluştur
2. `POST /auth/login` — token al
3. `POST /rows/users` — public profil oluştur

Adım 3 başarısız olursa (SORUN #7 nedeniyle 403) auth user oluştu ama profil yok
→ tutarsız state, rollback mekanizması yok.

**Beklenen davranış:** Signup body'sine `metadata: Record<string, unknown>` eklenebilmeli.

---

### SORUN #7 — KRİTİK: Varsayılan Kullanıcı Rolü "viewer" — Write Scope Yok

**Bu testin en önemli bulgusudur.**

**Ne yapmaya çalıştım:**
Yeni kayıt olan bir kullanıcının tweet oluşturmasını, profil kaydetmesini istedim.

**Bulgular (`scopeGuard.ts`, `db/index.ts`):**
DB user token'ları `authenticateAny` sayesinde `/db/:database/rows/*` ve
`/db/:database/query` endpoint'lerine erişiyor — bu doğru ve iyi tasarım.

Ama `scopeGuard.ts`'deki rol-scope eşlemesi:

```
admin:  [read, write, delete, schema, query]
editor: [read, write, delete]
viewer: [read]
```

`_postgrify_auth.users` tablosunda yeni kullanıcıların varsayılan rolü: `viewer`.

**Somut sonuçlar:**
- Yeni kayıt → `viewer` rolü → sadece `read` scope
- Tweet oluşturma → `write` scope → **403 Forbidden**
- Signup sonrası profil insert → `write` scope → **403 Forbidden**
- Beğeni, takip, tweet silme → `write`/`delete` → **403 Forbidden**

Kullanıcı kayıt olunca hiçbir şey yazamıyor. Rol yükseltmek için
`PATCH /db/:database/auth/users/:id` (`schema` scope) ile admin müdahalesi gerekiyor.

**Chicken-and-egg problemi:**
Yeni kullanıcı kayıt olur → viewer → profil için write gerekir → 403 → profil yok
→ uygulama kırık. Rol yükseltmek için admin gerekir → admin hesabı olmayan uygulama
bunu yapamaz.

**Hızlı çözüm önerisi:**
`auth_settings` tablosuna `default_user_role` alanı ekle (varsayılan: "viewer").
Uygulama geliştiricisi bunu "editor" olarak yapılandırabilsin.

---

### SORUN #8 — Hesap Silme: Kullanıcı Kendi Hesabını Silemez

**Ne yapmaya çalıştım:**
"Hesabı sil" butonu için kullanıcının kendi auth hesabını silmesini istedim.

**Bulgular:**
`DELETE /db/:database/auth/users/:id` endpoint'i `schema` scope gerektiriyor.
Normal kullanıcı (`viewer` veya `editor`) bu endpoint'e erişemiyor.
`DELETE /db/:database/auth/me` gibi self-delete endpoint'i hiç yok.

**Etki:** Hesap silme için admin müdahalesi veya backend proxy katmanı gerekiyor.

**Beklenen davranış:**
`DELETE /db/:database/auth/me` endpoint'i ekle — user token ile sadece kendi hesabını siler.

---

### SORUN #9 — Bulk Insert: Destekleniyor (Başta Yanlış Değerlendirdim)

`POST /db/:database/rows/:table` body'de array of objects kabul ediyor.
`[{...}, {...}]` formatında tek request'te toplu insert yapılabiliyor. Bu iyi bir özellik.

---

### SORUN #10 — Cursor-Based Pagination Yok

`GET /db/:database/rows/:table?limit=20&offset=40` çalışıyor; `total` count dönüyor.

**Eksik:** Twitter tarzı infinite scroll için cursor-based pagination (`created_at` bazlı)
yok. Bunu yapmak için `/query` endpoint'ine ham SQL şart.

---

### SORUN #11 — KRİTİK: Editor Rolü Timeline Göremez (query Scope Eksik)

**Ne yapmaya çalıştım:**
Kullanıcının takip ettiği kişilerin tweetlerini (timeline) göstermek istedim.

**Bulgular:**
Timeline JOIN gerektiriyor (tweets + users) → `/query` endpoint'i zorunlu →
`query` scope zorunlu.

`scopeGuard.ts`'de:
- `viewer`: `[read]` — query yok
- `editor`: `[read, write, delete]` — query yok
- `admin`: `[read, write, delete, schema, query]` — query var

Sadece `admin` rolündeki kullanıcılar JOIN sorgusu çalıştırabiliyor.
Normal bir uygulama kullanıcısı (`editor`) kendi timeline'ını göremez.

**Sorunun kökü:** JOIN desteği olmaması (SORUN #4), `/query` kullanımını zorunlu kılıyor.
`/query` ise SELECT-only modda bile `query` scope istiyor. `query` scope sadece admin'de var.

**Beklenen davranış:**
`editor` rolüne `query` scope eklenmeli. Ya da: SELECT-only modda `read` scope yeterli sayılmalı.
Yıkıcı olmayan SELECT sorgusu için ayrı bir `query` scope ayrımı anlamsız.

---

### SORUN #12 — Email Doğrulama + Profil Oluşturma Race Condition

**Bulgular:**
`email_verify_required: true` iken signup yapılırsa session dönmez; kullanıcı email
doğrulanmadan login yapamıyor. Bu sırada profil oluşturma adımı (SORUN #6) yapılamıyor.

Email doğrulandıktan sonra login yapıldığında profil oluşturma adımının düştüğü için
tutarsız hesap oluşuyor.

SORUN #6 + SORUN #7 ile bileşik: çok adımlı, yüksek partial-failure riskli kayıt akışı.

---

### SORUN #13 — SQL Injection Riski: /query'de String Interpolasyon Cazip

**Bulgular:**
`/query` endpoint'i `params: []` array ile parametrik sorgular destekliyor — doğru yol bu.

Ama JOIN ve dynamic SQL yazarken string interpolasyon çok daha kolay görünüyor:
`WHERE user_id = '${userId}'` vs `WHERE user_id = $1` + `params: [userId]`.

Test projemizde zaman zaman string interpolasyona kaçtık. Bu güvenli UUID için
sorun değil ama genel olarak kötü alışkanlık edindiriyor.

**Önerilen çözüm:** Dokümantasyon ve örnekler parametrik kullanımı güçlü vurgulamalı.

---

### SORUN #14 — DataClient SDK Tamamen Belgesiz

**Bulgular:**
`auth-js/src/dataClient.ts` incelendiğinde `createDataClient` ve `FluentQuery` mevcut
ve `index.ts`'den export ediliyor:

```typescript
const db = createDataClient({ url, database, token: dbScopedJwt })
const { data } = await db.from('users').where('role.eq.admin').limit(10).get()
```

Bu SDK hem daha güvenli (parametrik) hem daha okunabilir.

**Sorun:** CLAUDE.md, README ve dokümantasyonun hiçbir yerinde `createDataClient`'tan
bahsedilmiyor. Paket "zero-dep auth SDK" olarak tanıtılıyor ama aslında tam bir
veri erişim katmanı da içeriyor.

Test projesi boyunca ham API istekleri yazdık; DataClient'ı kaynak kodu okurken sonradan
keşfettik. Eğer dokümante edilseydi tüm data erişim kodunu daha temiz ve güvenli yazardık.

**Beklenen davranış:** Üç client açıkça tanıtılmalı:
- `createClient` — end-user auth (belgelenmiş)
- `createAdminClient` — admin işlemleri (belgelenmiş)
- `createDataClient` — veri CRUD ve SQL (**EKSİK**)

---

### SORUN #15 — Admin Token ile DDL: ALLOW_RAW_SQL_ADMIN=true Zorunlu

**Ne yapmaya çalıştım:**
Admin token ile FK ve index oluşturmak için `/query` endpoint'ine DDL SQL gönderdim.

**Bulgular (`query.ts`):**
```typescript
const isAdmin = req.user?.role === "admin";
const adminFullSqlEnabled = config.ALLOW_RAW_SQL_ADMIN;

if (!(isAdmin && adminFullSqlEnabled)) {
  // SELECT-only mod — DDL engellenir
}
```

Admin token olsa bile `ALLOW_RAW_SQL_ADMIN=false` (varsayılan) ise DDL çalışmıyor.

SORUN #1 ile bileşik: FK için tek yol `ALLOW_RAW_SQL_ADMIN=true` + admin token + `/query`.
Bu yapılandırma gereksinimi hiçbir yerde belgelenmiyor.

**Beklenen davranış:** Ya admin token DDL'i her zaman çalıştırabilmeli (en az sürpriz),
ya da bu gereksinim kurulum dokümantasyonunda açıkça belirtilmeli.

---

## ÖZET: Postgrify Twitter Clone İçin Yeterli Mi?

| Özellik | Durum | Sorun No |
|---------|-------|----------|
| Kullanıcı kaydı (email/password) | ✅ Çalışıyor | — |
| Kullanıcı girişi | ✅ Çalışıyor | — |
| Auto token refresh (SDK) | ✅ Çalışıyor | — |
| DB user token → data API erişimi | ✅ Çalışıyor | — |
| Bulk insert | ✅ Çalışıyor | — |
| Parametrik SQL (/query) | ✅ Çalışıyor | — |
| Tablo oluşturma (DDL) | ⚠️ FK yok | #1 |
| Tweet görsel paylaşma | ⚠️ Sadece URL | #2 |
| Hesap silme (kendi) | ⚠️ Admin gerekli | #8 |
| Cursor pagination | ⚠️ Offset var | #10 |
| DataClient SDK | ⚠️ Belgesiz | #14 |
| Admin token ile DDL | ⚠️ Env var gerekli | #15 |
| Yeni kullanıcı write scope | ❌ Viewer 403 | **#7** |
| Signup sonrası profil oluşturma | ❌ 403 | **#7** |
| Tweet oluşturma | ❌ 403 | **#7** |
| Timeline (JOIN sorgusu) | ❌ query scope yok | **#11** |
| Custom signup alanları | ❌ Yok | #6 |
| Email verify + profil oluşturma | ❌ Race condition | #12 |

---

## Kritik Sorunlar (Öncelik Sırasıyla)

### 1. SORUN #7 — Varsayılan Rol "viewer" (En Kritik)

Yeni kayıt olan kullanıcı hiçbir şey yazamıyor. Temel kullanılabilirliği kırıyor.

**Hızlı çözüm:** `auth_settings` tablosuna `default_user_role` alanı ekle.
Geliştirici "editor" olarak yapılandırabilsin.

### 2. SORUN #11 — Editor Rolünde query Scope Yok (Kritik)

Timeline için JOIN şart → /query şart → query scope şart → sadece admin rolünde var.
Normal kullanıcı kendi timeline'ını göremez.

**Hızlı çözüm:** `editor` rolüne `query` scope ekle. Ya da SELECT-only modda
`read` scope yeterli sayılsın.

### 3. SORUN #6 — Çok Adımlı Kayıt (Önemli)

Signup → Login → Profil akışı kırılgan, partial failure riski yüksek.

**Hızlı çözüm:** `signUp()` parametresine `metadata: Record<string, unknown>` ekle.

### 4. SORUN #8 — Kendi Hesabını Silme (Orta)

**Hızlı çözüm:** `DELETE /db/:database/auth/me` endpoint'i ekle.

### 5. SORUN #14 — DataClient Belgesiz (Orta)

**Hızlı çözüm:** README'ye üçüncü client factory'yi ekle, kullanım örneği göster.

---

## Genel Değerlendirme

Postgrify'ın temel mimarisi iyi tasarlanmış:
- Auth SDK kaliteli ve kapsamlı
- `authenticateAny` pattern'i doğru (DB user token'ları data API'ye erişiyor)
- Rows endpoint'i filter/sort/pagination ile kullanışlı
- Bulk insert destekleniyor
- Parametrik SQL destekleniyor

Ancak **rol-scope sistemi çok kısıtlayıcı**: varsayılan `viewer` rolü veri yazmayı
tamamen engelliyor. `editor` rolünde `query` scope olmaması, JOIN içeren her sorguyu
imkânsız kılıyor. Bu iki sorun birlikte Postgrify'ı gerçek bir uygulama backend'i
olarak şu haliyle kullanılamaz hale getiriyor.

**Postgrify bu haliyle Twitter klonu için yeterli değil.** Ancak SORUN #7 ve SORUN #11
çözülseydi büyük ölçüde yeterli olurdu — temel altyapı sağlam.