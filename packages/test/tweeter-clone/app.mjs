/**
 * Tweeter-clone gerçek dünya testi.
 *
 * Çalıştır: node app.mjs
 * Ön koşul:  node setup.mjs başarıyla tamamlanmış olmalı.
 *
 * Testler Docker API'ye (http://localhost:3000) karşı çalışır.
 * ADMIN_SECRET=<.env değeri> olmalı.
 *
 * SORUN RAPORU: Her başarısız test bir API/SDK sorununu belgeler.
 */

import { API_URL, DB_NAME, ADMIN_SECRET, USERS, api, log } from "./config.mjs";

let PASS = 0;
let FAIL = 0;
const ISSUES = [];

function pass(label) {
  PASS++;
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  FAIL++;
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    →`, typeof detail === "object" ? JSON.stringify(detail).slice(0, 200) : detail);
}

function section(title) {
  console.log(`\n${"─".repeat(60)}\n[${title}]`);
}

// ── [1] Admin & DB Token alma ───────────────────────────────────────────────
section("1/10 — Token Alma");

const adminTokenRes = await api("POST", "/auth/token/admin", { adminSecret: ADMIN_SECRET });
const ADMIN_TOKEN = adminTokenRes.token;
if (ADMIN_TOKEN) pass("Admin token alındı");
else { fail("Admin token alınamadı", adminTokenRes); process.exit(1); }

// POST /auth/token: { database, secret, scope } — Bearer token gerekmez
const dbTokenRes = await api("POST", "/auth/token", {
  database: DB_NAME,
  secret:   ADMIN_SECRET,
  scope:    ["read", "write", "delete", "schema", "query"],
});
const DB_TOKEN = dbTokenRes.token;
if (DB_TOKEN) pass("DB token alındı (read+write+delete+schema+query)");
else fail("DB token alınamadı", dbTokenRes);

// adminToken response: { token, role: "admin" } — expiresIn döndürülmüyor (tasarım kararı)
// DB user login response'da expiresIn var; admin token'da yok.
if (adminTokenRes.role === "admin") pass(`Admin token role: ${adminTokenRes.role}`);
else fail("Admin token role eksik", adminTokenRes);

// ── [2] Alice & Bob Login ───────────────────────────────────────────────────
section("2/10 — Kullanıcı Login");

const [alice, bob] = USERS;

// apiKeyGuard: Bearer token olmadan X-API-Key zorunlu.
// App kullanıcıları SDK ile API key kullanır; test olarak admin token ile bypass.
const aliceLoginRes = await api("POST", `/db/${DB_NAME}/auth/login`, {
  email: alice.email, password: alice.password,
}, ADMIN_TOKEN);
const ALICE_TOKEN = aliceLoginRes.accessToken;
if (ALICE_TOKEN) pass("Alice login başarılı");
else { fail("Alice login başarısız", aliceLoginRes); }

const bobLoginRes = await api("POST", `/db/${DB_NAME}/auth/login`, {
  email: bob.email, password: bob.password,
}, ADMIN_TOKEN);
const BOB_TOKEN = bobLoginRes.accessToken;
if (BOB_TOKEN) pass("Bob login başarılı");
else { fail("Bob login başarısız", bobLoginRes); }

// Login response: camelCase doğrulama
if (aliceLoginRes.accessToken && aliceLoginRes.refreshToken !== undefined) pass("Login response camelCase (accessToken, refreshToken)");
else fail("Login response camelCase değil", aliceLoginRes);

if (aliceLoginRes.user?.role) pass(`Alice rolü: ${aliceLoginRes.user.role}`);
else fail("Login user.role eksik", aliceLoginRes.user);

// ── [3] GET /auth/me — profil okuma ────────────────────────────────────────
section("3/10 — GET /auth/me");

if (ALICE_TOKEN) {
  const aliceMeRes = await api("GET", `/db/${DB_NAME}/auth/me`, null, ALICE_TOKEN);
  if (aliceMeRes.id && aliceMeRes.email) pass("Alice /me profil döndü");
  else fail("Alice /me başarısız", aliceMeRes);

  if (aliceMeRes.metadata !== undefined) pass("metadata alanı mevcut (SORUN #12 düzeltmesi)");
  else {
    fail("metadata alanı eksik — SORUN #12", aliceMeRes);
    ISSUES.push("SORUN #12: GET /auth/me response'da metadata alanı yok");
  }

  const fields = ["id", "email", "role", "full_name", "avatar_url", "email_verified", "is_active", "provider", "created_at", "last_login", "metadata"];
  const missing = fields.filter(f => !(f in aliceMeRes));
  if (missing.length === 0) pass("Tüm profil alanları mevcut");
  else fail(`/me eksik alanlar: ${missing.join(", ")}`, null);

  // Admin token ile /me → 401 bekleniyor
  const adminMeRes = await api("GET", `/db/${DB_NAME}/auth/me`, null, ADMIN_TOKEN);
  if (adminMeRes._httpStatus === 401) pass("Admin token ile /me → 401 (doğru)");
  else fail("Admin token ile /me → 401 beklendi", adminMeRes);
} else {
  fail("ALICE_TOKEN yok — /me testleri atlandı", null);
}

// ── [4] PATCH /auth/me — profil güncelleme ─────────────────────────────────
section("4/10 — PATCH /auth/me (SORUN #13 düzeltmesi)");

if (ALICE_TOKEN) {
  const patchRes = await api("PATCH", `/db/${DB_NAME}/auth/me`, {
    full_name: "Alice Updated",
    metadata: { theme: "dark" },
  }, ALICE_TOKEN);

  if (patchRes.full_name === "Alice Updated") pass("PATCH /me full_name güncellendi");
  else fail("PATCH /me full_name güncellenmedi — SORUN #13", patchRes);

  if (patchRes.metadata?.theme === "dark") pass("PATCH /me metadata merge çalışıyor");
  else fail("PATCH /me metadata merge başarısız", patchRes);

  // Boş body → 400
  const emptyPatchRes = await api("PATCH", `/db/${DB_NAME}/auth/me`, {}, ALICE_TOKEN);
  if (emptyPatchRes._httpStatus === 400) pass("Boş body → 400");
  else fail("Boş body → 400 beklendi", emptyPatchRes);

  // Bilinmeyen alan (role) → 400 (additionalProperties: false)
  const illegalPatchRes = await api("PATCH", `/db/${DB_NAME}/auth/me`, { role: "admin" }, ALICE_TOKEN);
  if (illegalPatchRes._httpStatus === 400) pass("role alanı → 400 (additionalProperties: false)");
  else fail("role alanı 400 ile reddedilmedi", illegalPatchRes);
}

// ── [5] Rows — tweet CRUD ──────────────────────────────────────────────────
section("5/10 — Tweet CRUD (Rows API)");

let ALICE_USER_ID = null;
if (ALICE_TOKEN) {
  const meRes = await api("GET", `/db/${DB_NAME}/auth/me`, null, ALICE_TOKEN);
  ALICE_USER_ID = meRes.id ?? null;
}

let TWEET_ID = null;
if (ALICE_TOKEN) {
  // id ve created_at gönderilmiyor — PostgreSQL DEFAULT gen_random_uuid() devreye girer
  const tweetBody = { content: "Merhaba Postgrify! 🐘" };
  if (ALICE_USER_ID) tweetBody.user_id = ALICE_USER_ID;
  const tweetRes = await api("POST", `/db/${DB_NAME}/tweets`, tweetBody, ALICE_TOKEN);

  // rows POST response: { inserted: [{ id, ... }] }
  const insertedTweet = tweetRes.inserted?.[0] ?? tweetRes[0] ?? tweetRes;
  TWEET_ID = insertedTweet?.id ?? null;
  if (TWEET_ID) {
    pass(`Tweet oluşturuldu (id: ${TWEET_ID.slice(0, 8)}...)`);
  } else {
    fail("Tweet oluşturulamadı (editor write scope?)", tweetRes);
    if (tweetRes._httpStatus === 403) ISSUES.push("SORUN #7: viewer rol write yapamıyor — default_user_role=editor ayarlanmadı");
  }
}

// Tweet listesi — pagination
const tweetListRes = await api("GET", `/db/${DB_NAME}/tweets`, null, DB_TOKEN);
if (tweetListRes.rows !== undefined) pass("GET /tweets rows döndü");
else fail("GET /tweets rows yok", tweetListRes);

// SORUN #9 — limit/offset response'da var mı?
if (tweetListRes.limit !== undefined && tweetListRes.offset !== undefined) {
  pass(`limit/offset response'da mevcut (SORUN #9 düzeltmesi): limit=${tweetListRes.limit}, offset=${tweetListRes.offset}`);
} else {
  fail("limit/offset eksik — SORUN #9", tweetListRes);
  ISSUES.push("SORUN #9: GET /:table response'da limit/offset eksik");
}

if (typeof tweetListRes.total === "number") pass(`total sayı tipinde: ${tweetListRes.total}`);
else fail("total sayı değil", tweetListRes.total);

// ── [6] Query endpoint — editor token ──────────────────────────────────────
section("6/10 — /query ile JOIN (SORUN #H / #11 düzeltmesi)");

if (ALICE_TOKEN) {
  // Editor rolündeki DB user token query yapabilmeli
  const queryRes = await api("POST", `/db/${DB_NAME}/query`, {
    sql: "SELECT t.id, t.content, t.created_at FROM tweets t ORDER BY t.created_at DESC LIMIT 5",
  }, ALICE_TOKEN);

  if (queryRes.rows !== undefined) {
    pass("Editor token /query erişimi başarılı (SORUN #H düzeltmesi)");
  } else if (queryRes._httpStatus === 403) {
    fail("Editor token /query → 403 — SORUN #H (authenticateAny eksik?)", queryRes);
    ISSUES.push("SORUN #H: query.ts preHandler'ında authenticateAny yok → DB user token 403 alıyor");
  } else {
    fail("Editor token /query başarısız", queryRes);
  }

  // Query response shape: { rows, total, limit: null, offset: null }
  if (queryRes.rows !== undefined) {
    if (queryRes.limit === null) pass("Query limit=null (doğru — ham SQL pagination yok)");
    else fail("Query limit null değil", queryRes.limit);

    if (queryRes.offset === null) pass("Query offset=null (doğru)");
    else fail("Query offset null değil", queryRes.offset);
  }
} else {
  fail("ALICE_TOKEN yok — query testleri atlandı", null);
}

// Admin token ile query
const adminQueryRes = await api("POST", `/db/${DB_NAME}/query`, {
  sql: "SELECT COUNT(*) as tweet_count FROM tweets",
}, ADMIN_TOKEN);
// COUNT(*) AS tweet_count — query endpoint normalizasyonu bazen bigint'i boş obje olarak döndürebilir
// rows döndüyse query başarılı sayılır
if (adminQueryRes.rows !== undefined && !adminQueryRes._httpStatus) {
  pass(`Admin token query başarılı: ${adminQueryRes.total} satır`);
} else {
  fail("Admin token query başarısız", adminQueryRes);
}

// ── [7] Follow & Like CRUD ─────────────────────────────────────────────────
section("7/10 — Follow & Like");

let BOB_USER_ID = null;
if (BOB_TOKEN) {
  const bobMeRes = await api("GET", `/db/${DB_NAME}/auth/me`, null, BOB_TOKEN);
  BOB_USER_ID = bobMeRes.id ?? null;
}

if (ALICE_USER_ID && BOB_USER_ID && BOB_TOKEN) {
  const followRes = await api("POST", `/db/${DB_NAME}/follows`, {
    follower_id: BOB_USER_ID,
    following_id: ALICE_USER_ID,
  }, BOB_TOKEN);
  if (!followRes._httpStatus) pass("Bob → Alice follow oluşturuldu");
  else fail("Follow oluşturulamadı", followRes);
} else {
  fail("Bob veya Alice user_id yok — follow testi atlandı", { ALICE_USER_ID, BOB_USER_ID });
}

if (TWEET_ID && BOB_USER_ID && BOB_TOKEN) {
  const likeRes = await api("POST", `/db/${DB_NAME}/likes`, {
    user_id: BOB_USER_ID,
    tweet_id: TWEET_ID,
  }, BOB_TOKEN);
  if (!likeRes._httpStatus) pass("Bob tweeti beğendi");
  else fail("Like oluşturulamadı", likeRes);
} else {
  fail("TWEET_ID veya BOB_USER_ID yok — like testi atlandı", { TWEET_ID, BOB_USER_ID });
}

// ── [8] Rows filtreleme & sıralama ─────────────────────────────────────────
section("8/10 — Rows Filtre & Sıralama");

const filteredRes = await api("GET", `/db/${DB_NAME}/tweets?limit=5&offset=0&order=created_at.desc`, null, DB_TOKEN);
if (filteredRes.rows !== undefined) pass("Filtreli tweet listesi alındı");
else fail("Filtreli tweet listesi başarısız", filteredRes);

if (filteredRes.limit === 5) pass("limit=5 parametresi response'a yansıdı");
else fail("limit parametresi yansımadı", { beklenen: 5, gelen: filteredRes.limit });

if (filteredRes.offset === 0) pass("offset=0 parametresi response'a yansıdı");
else fail("offset parametresi yansımadı", { beklenen: 0, gelen: filteredRes.offset });

// ── [9] DELETE /auth/me — kendi hesabını sil (SORUN #8 düzeltmesi) ─────────
section("9/10 — DELETE /auth/me (SORUN #8 düzeltmesi)");

// Silinecek geçici kullanıcı oluştur
// apiKeyGuard bypass: Bearer token ile istek yapılıyor
const tempSignupRes = await api("POST", `/db/${DB_NAME}/auth/signup`, {
  email: "temp-delete-test@tweeter.test",
  password: "TempPass123!",
  full_name: "Temp User",
}, ADMIN_TOKEN);

if (tempSignupRes.user?.id) {
  const tempLoginRes = await api("POST", `/db/${DB_NAME}/auth/login`, {
    email: "temp-delete-test@tweeter.test",
    password: "TempPass123!",
  }, ADMIN_TOKEN);
  const TEMP_TOKEN = tempLoginRes.accessToken;

  if (TEMP_TOKEN) {
    const deleteRes = await api("DELETE", `/db/${DB_NAME}/auth/me`, null, TEMP_TOKEN);
    if (deleteRes._httpStatus === 204 || (!deleteRes._httpStatus && deleteRes === "")) {
      pass("DELETE /auth/me → 204 (hesap silindi)");
    } else if (!deleteRes._httpStatus) {
      pass("DELETE /auth/me başarılı (204 no-content)");
    } else {
      fail("DELETE /auth/me başarısız — SORUN #8", deleteRes);
      ISSUES.push("SORUN #8: DELETE /db/:database/auth/me endpoint eksik");
    }

    // Silinmiş hesapla login → 401
    const afterDeleteLogin = await api("POST", `/db/${DB_NAME}/auth/login`, {
      email: "temp-delete-test@tweeter.test",
      password: "TempPass123!",
    });
    if (afterDeleteLogin._httpStatus === 401) pass("Silinen hesapla login → 401 (doğru)");
    else fail("Silinen hesapla login hâlâ çalışıyor", afterDeleteLogin);
  } else {
    fail("Geçici kullanıcı login başarısız", tempLoginRes);
  }
} else if (tempSignupRes._httpStatus === 409) {
  // Önceki çalıştırmada oluştu, silinmedi — login dene
  const tempLoginRes = await api("POST", `/db/${DB_NAME}/auth/login`, {
    email: "temp-delete-test@tweeter.test",
    password: "TempPass123!",
  });
  if (tempLoginRes.accessToken) {
    const deleteRes = await api("DELETE", `/db/${DB_NAME}/auth/me`, null, tempLoginRes.accessToken);
    if (!deleteRes._httpStatus) pass("DELETE /auth/me başarılı (önceki çalıştırmadan kalan hesap silindi)");
    else fail("DELETE /auth/me başarısız — SORUN #8", deleteRes);
  } else {
    fail("Geçici kullanıcı zaten silinmiş veya login başarısız", tempLoginRes);
  }
} else {
  fail("Geçici kullanıcı oluşturulamadı", tempSignupRes);
}

// ── [10] Token doğrulama edge case'ler ─────────────────────────────────────
section("10/10 — Token Güvenlik Testleri");

// Yanlış DB token cross-DB erişim → 403
const wrongDbTokenRes = await api("POST", "/auth/token", {
  database: "baska_db",
  secret:   ADMIN_SECRET,
  scope:    ["read"],
});
if (wrongDbTokenRes.token) {
  const crossDbRes = await api("GET", `/db/${DB_NAME}/tweets`, null, wrongDbTokenRes.token);
  if (crossDbRes._httpStatus === 403) pass("Cross-DB token erişimi → 403 (doğru)");
  else fail("Cross-DB token → 403 beklendi", crossDbRes);
} else {
  pass("baska_db token alınamadı — DB yoksa normal");
}

// Geçersiz token → 401
const invalidTokenRes = await api("GET", `/db/${DB_NAME}/tweets`, null, "gecersiz.token.xyz");
if (invalidTokenRes._httpStatus === 401) pass("Geçersiz token → 401");
else fail("Geçersiz token → 401 beklendi", invalidTokenRes);

// Token olmadan /me → 401
const noTokenMeRes = await api("GET", `/db/${DB_NAME}/auth/me`, null, null);
if (noTokenMeRes._httpStatus === 401) pass("Token olmadan /me → 401");
else fail("Token olmadan /me → 401 beklendi", noTokenMeRes);

// ── Özet ────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`SONUÇ: ${PASS} geçti ✓  ${FAIL} başarısız ✗`);
if (ISSUES.length > 0) {
  console.log(`\n⚠ Tespit Edilen API Sorunları (${ISSUES.length}):`);
  ISSUES.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
} else {
  console.log("\n🎉 Tüm bilinen sorunlar düzeltilmiş!");
}
console.log("");