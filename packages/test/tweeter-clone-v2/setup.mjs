/**
 * tweeter-clone-v2 setup
 *
 * Kullanım:
 *   ADMIN_SECRET=xxx API_URL=http://localhost:3000 node setup.mjs
 */

const API_URL     = process.env.API_URL     ?? "http://localhost:3000";
const DB_NAME     = process.env.DB_NAME     ?? "tweeter2";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "replace-with-min-16-char-admin-secret";

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) json._httpStatus = res.status;
  return json;
}

function ok(msg)  { console.log(`  ✓ ${msg}`); }
function err(msg, data) { console.error(`  ✗ ${msg}`, data ?? ""); }

// ── Admin token al ─────────────────────────────────────────────────────────────
const adminTokenRes = await api("POST", "/auth/token/admin", { adminSecret: ADMIN_SECRET });
if (!adminTokenRes.token) { console.error("Admin token alınamadı:", adminTokenRes); process.exit(1); }
const ADMIN_TOKEN = adminTokenRes.token;
ok("Admin token alındı");

// ── DB oluştur ─────────────────────────────────────────────────────────────────
const createDbRes = await api("POST", "/admin/databases", { name: DB_NAME }, ADMIN_TOKEN);
const dbAlreadyExists =
  createDbRes._httpStatus === 409 ||
  (createDbRes._httpStatus === 500 && createDbRes.error?.includes("already exists"));
if (createDbRes._httpStatus && !dbAlreadyExists) {
  console.error("DB oluşturulamadı:", createDbRes); process.exit(1);
}
if (dbAlreadyExists) ok(`${DB_NAME} zaten mevcut`);
else ok(`${DB_NAME} DB oluşturuldu`);

// ── DB token (full scope) ─────────────────────────────────────────────────────
const dbTokenRes = await api("POST", "/auth/token", {
  database: DB_NAME,
  secret:   ADMIN_SECRET,
  scope:    ["read", "write", "delete", "schema", "query"],
});
if (!dbTokenRes.token) { console.error("DB token alınamadı:", dbTokenRes); process.exit(1); }
const DB_TOKEN = dbTokenRes.token;
ok("DB token alındı");

// ── Auth kullanıcılarını temizle ───────────────────────────────────────────────
await api("POST", `/db/${DB_NAME}/query`, {
  sql: "DELETE FROM _postgrify_auth.sessions",
}, ADMIN_TOKEN).catch(() => {});
await api("POST", `/db/${DB_NAME}/query`, {
  sql: "DELETE FROM _postgrify_auth.users",
}, ADMIN_TOKEN).catch(() => {});
ok("Auth kullanıcıları temizlendi");

// ── Tabloları sil ve yeniden oluştur ─────────────────────────────────────────
const tables = ["likes", "follows", "tweets", "users_profile"];
for (const tbl of tables) {
  await api("DELETE", `/db/${DB_NAME}/tables/${tbl}`, null, ADMIN_TOKEN).catch(() => {});
}
ok("Eski tablolar silindi");

// users_profile — tweet kullanıcı bilgileri (ayrı profil tablosu)
const profileTableRes = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "users_profile",
  columns: [
    { name: "id",          type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "auth_id",     type: "uuid",      nullable: false, unique: true },
    { name: "username",    type: "varchar",   nullable: false, unique: true },
    { name: "display_name",type: "varchar",   nullable: false },
    { name: "bio",         type: "text",      nullable: true },
    { name: "avatar_url",  type: "text",      nullable: true },
    { name: "created_at",  type: "timestamp", nullable: false, default: "now()" },
  ],
}, ADMIN_TOKEN);
if (profileTableRes._httpStatus) { err("users_profile oluşturulamadı", profileTableRes); }
else ok("users_profile tablosu oluşturuldu");

// tweets
const tweetsTableRes = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "tweets",
  columns: [
    { name: "id",          type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "user_id",     type: "uuid",      nullable: false },
    { name: "content",     type: "text",      nullable: false },
    { name: "image_url",   type: "text",      nullable: true },
    { name: "reply_to",    type: "uuid",      nullable: true },
    { name: "like_count",  type: "integer",   nullable: false, default: "0" },
    { name: "retweet_count",type:"integer",   nullable: false, default: "0" },
    { name: "created_at",  type: "timestamp", nullable: false, default: "now()" },
  ],
}, ADMIN_TOKEN);
if (tweetsTableRes._httpStatus) { err("tweets oluşturulamadı", tweetsTableRes); }
else ok("tweets tablosu oluşturuldu");

// follows
const followsTableRes = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "follows",
  columns: [
    { name: "id",           type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "follower_id",  type: "uuid",      nullable: false },
    { name: "following_id", type: "uuid",      nullable: false },
    { name: "created_at",   type: "timestamp", nullable: false, default: "now()" },
  ],
}, ADMIN_TOKEN);
if (followsTableRes._httpStatus) { err("follows oluşturulamadı", followsTableRes); }
else ok("follows tablosu oluşturuldu");

// likes
const likesTableRes = await api("POST", `/db/${DB_NAME}/tables`, {
  name: "likes",
  columns: [
    { name: "id",         type: "uuid",      primaryKey: true, default: "gen_random_uuid()", nullable: false },
    { name: "user_id",    type: "uuid",      nullable: false },
    { name: "tweet_id",   type: "uuid",      nullable: false },
    { name: "created_at", type: "timestamp", nullable: false, default: "now()" },
  ],
}, ADMIN_TOKEN);
if (likesTableRes._httpStatus) { err("likes oluşturulamadı", likesTableRes); }
else ok("likes tablosu oluşturuldu");

// ── Auth ayarları ─────────────────────────────────────────────────────────────
const settingsRes = await api("PUT", `/db/${DB_NAME}/auth/settings`, {
  email_signup_enabled:  "true",
  email_verify_required: "false",
  default_user_role:     "editor",
}, ADMIN_TOKEN);
if (settingsRes._httpStatus) err("Auth ayarları kaydedilemedi", settingsRes);
else ok("Auth ayarları: email_signup=true, verify_required=false, default_role=editor");

// ── API key al ────────────────────────────────────────────────────────────────
const apiKeyRes = await api("GET", `/admin/databases/${DB_NAME}/api-key`, null, ADMIN_TOKEN);
const API_KEY = apiKeyRes.apiKey ?? apiKeyRes.api_key ?? "";
if (API_KEY) ok(`API key alındı: ${API_KEY.slice(0, 12)}...`);
else err("API key alınamadı", apiKeyRes);

// ── .env.local dosyasına yaz ──────────────────────────────────────────────────
const envContent = `# tweeter-clone-v2 ortam değişkenleri — node setup.mjs ile üretildi
VITE_API_URL=${API_URL}
VITE_DB_NAME=${DB_NAME}
VITE_API_KEY=${API_KEY}
VITE_DB_TOKEN=${DB_TOKEN}
`;

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(__dirname, "app", ".env.local"), envContent);
ok(".env.local yazıldı → app/.env.local");

console.log("\n✅ Setup tamamlandı!");
console.log(`   cd packages/test/tweeter-clone-v2/app && npm install && npm run dev`);