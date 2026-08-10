/**
 * Tweeter-clone test ortamı kurulumu.
 *
 * Çalıştır: node setup.mjs
 * Ön koşul:  API_URL'de Postgrify çalışıyor olmalı (varsayılan: http://localhost:3000)
 *             ADMIN_SECRET ortam değişkeni ayarlanmış olmalı.
 *
 * Bu script idempotent'tir — birden fazla çalıştırılabilir.
 * Her çalıştırma mevcut tabloları siler ve yeniden oluşturur.
 */

import { API_URL, DB_NAME, ADMIN_SECRET, USERS, api, log } from "./config.mjs";

// ── Admin token al ──────────────────────────────────────────────────────────

const adminTokenRes = await api("POST", "/auth/token/admin", { adminSecret: ADMIN_SECRET });
if (!adminTokenRes.token) {
  console.error("Admin token alınamadı:", adminTokenRes);
  process.exit(1);
}
const ADMIN_TOKEN = adminTokenRes.token;
console.log("✓ Admin token alındı");

// ── Tweetertest DB için DB token al ────────────────────────────────────────

const dbTokenRes = await api("POST", "/auth/token", {
  database: DB_NAME,
  secret:   ADMIN_SECRET,
  scope:    ["read", "write", "delete", "schema", "query"],
});
if (!dbTokenRes.token) {
  console.error("DB token alınamadı:", dbTokenRes);
  process.exit(1);
}
const DB_TOKEN = dbTokenRes.token;
console.log("✓ DB token alındı");

// ── Tweetertest DB'yi oluştur (yoksa) ──────────────────────────────────────
// POST /admin/databases ile yönetilen DB kaydedilir.
// DB zaten kayıtlıysa 409 döner — idempotent.
const createDbRes = await api("POST", "/admin/databases", {
  name:     DB_NAME,
  host:     process.env.PG_HOST     ?? "localhost",
  port:     parseInt(process.env.PG_PORT ?? "5432", 10),
  username: process.env.PG_USER     ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
}, ADMIN_TOKEN);
const dbAlreadyExists =
  createDbRes._httpStatus === 409 ||
  (createDbRes._httpStatus === 500 && createDbRes.error?.includes("already exists"));

if (createDbRes._httpStatus && !dbAlreadyExists) {
  console.error("DB oluşturulamadı:", createDbRes);
  process.exit(1);
}
if (dbAlreadyExists) {
  console.log(`  (bilgi) ${DB_NAME} zaten mevcut`);
} else {
  console.log(`✓ ${DB_NAME} DB'si oluşturuldu`);
}

// ── Auth kullanıcılarını temizle (bozuk metadata dahil) ─────────────────────
// DELETE /db/:db/auth/users/:id yerine query endpoint ile doğrudan sil.
// auth/users GET endpoint'i metadata array olunca 500 verir — query kullan.
const cleanAuthRes = await api("POST", `/db/${DB_NAME}/query`, {
  sql: `DELETE FROM _postgrify_auth.users WHERE email IN ('${USERS.map(u => u.email).join("','")}')`,
}, ADMIN_TOKEN);
if (!cleanAuthRes._httpStatus) {
  console.log("  auth kullanıcıları temizlendi");
}

// ── Mevcut tabloları temizle ────────────────────────────────────────────────

// Yabancı anahtar bağımlılığı olan sıra ile silelim
const DROP_ORDER = ["likes", "follows", "tweets", "users"];
for (const table of DROP_ORDER) {
  const res = await api("DELETE", `/db/${DB_NAME}/tables/${table}`, null, DB_TOKEN);
  // 404 zaten yoksa tamam; diğer hataları logla ama devam et
  if (res._httpStatus && res._httpStatus !== 404) {
    log(`  tablo silme uyarısı (${table})`, res);
  }
}
console.log("✓ Eski tablolar temizlendi");

// ── Tabloları oluştur ───────────────────────────────────────────────────────

const createUsers = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "users",
  columns: [
    { name: "id",           type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "auth_id",      type: "uuid",      nullable: true,   unique: true },
    { name: "username",     type: "text",      nullable: false,  unique: true },
    { name: "display_name", type: "text",      nullable: true },
    { name: "bio",          type: "text",      nullable: true },
    { name: "avatar_url",   type: "text",      nullable: true },
    { name: "created_at",   type: "timestamp", nullable: false,  default: "now()" },
  ],
}, DB_TOKEN);
if (createUsers._httpStatus) { console.error("users tablosu oluşturulamadı:", createUsers); process.exit(1); }
console.log("✓ users tablosu oluşturuldu");

const createTweets = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "tweets",
  columns: [
    { name: "id",         type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "user_id",    type: "uuid",      nullable: false },
    { name: "content",    type: "text",      nullable: false },
    { name: "image_url",  type: "text",      nullable: true },
    { name: "reply_to",   type: "uuid",      nullable: true },
    { name: "created_at", type: "timestamp", nullable: false, default: "now()" },
  ],
}, DB_TOKEN);
if (createTweets._httpStatus) { console.error("tweets tablosu oluşturulamadı:", createTweets); process.exit(1); }
console.log("✓ tweets tablosu oluşturuldu");

const createFollows = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "follows",
  columns: [
    { name: "follower_id",  type: "uuid", nullable: false },
    { name: "following_id", type: "uuid", nullable: false },
    { name: "created_at",   type: "timestamp", nullable: false, default: "now()" },
  ],
}, DB_TOKEN);
if (createFollows._httpStatus) { console.error("follows tablosu oluşturulamadı:", createFollows); process.exit(1); }
console.log("✓ follows tablosu oluşturuldu");

const createLikes = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "likes",
  columns: [
    { name: "user_id",    type: "uuid",      nullable: false },
    { name: "tweet_id",   type: "uuid",      nullable: false },
    { name: "created_at", type: "timestamp", nullable: false, default: "now()" },
  ],
}, DB_TOKEN);
if (createLikes._httpStatus) { console.error("likes tablosu oluşturulamadı:", createLikes); process.exit(1); }
console.log("✓ likes tablosu oluşturuldu");

// ── Auth ayarlarını yapılandır ──────────────────────────────────────────────
// default_user_role=editor: yeni kaydolan kullanıcılar veri yazabilsin (SORUN #7)
// apiKeyGuard: Bearer token varsa atlanır — admin token yeterli

const settingsRes = await api("PUT", `/db/${DB_NAME}/auth/settings`, {
  default_user_role: "editor",
  email_verify_required: "false",
  email_signup_enabled: "true",
}, ADMIN_TOKEN);
if (settingsRes._httpStatus) {
  console.error("Auth ayarları güncellenemedi:", settingsRes);
  process.exit(1);
}
console.log("✓ Auth ayarları: default_user_role=editor, email_verify_required=false");

// ── Test kullanıcılarını oluştur ────────────────────────────────────────────

// apiKeyGuard: Bearer token varsa X-API-Key kontrolü atlanır.
// Setup sırasında admin token ile signup yapıyoruz.
for (const user of USERS) {
  const res = await api("POST", `/db/${DB_NAME}/auth/signup`, {
    email:     user.email,
    password:  user.password,
    full_name: user.full_name,
  }, ADMIN_TOKEN);

  if (res._httpStatus === 409) {
    console.log(`  (uyarı) ${user.email} zaten kayıtlı — atlanıyor`);
    continue;
  }
  if (res._httpStatus) {
    console.error(`  ${user.email} kaydedilemedi:`, res);
    process.exit(1);
  }
  console.log(`✓ Kullanıcı oluşturuldu: ${user.email} (rol: ${res.user?.role})`);
}

console.log("\n✅ Setup tamamlandı. node app.mjs ile testleri çalıştırabilirsiniz.");