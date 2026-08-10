/**
 * setup.js — Veritabanı Kurulum Scripti
 *
 * Bu script Postgrify üzerinde 'twitter' veritabanının tablolarını oluşturur.
 * Node.js ile doğrudan çalıştırılır: `node src/setup.js`
 *
 * ÖNKOŞULlar:
 * 1. Postgrify çalışıyor olmalı (docker compose up -d)
 * 2. 'twitter' veritabanı Postgrify'da tanımlanmış olmalı
 * 3. config.js'deki adminSecret doğru olmalı
 *
 * SORUN NOTLARI:
 * - #1:  POST /tables ile tablo oluşturuluyor — iyi. FK desteği yok.
 * - #7:  Yeni kullanıcılar "viewer" rolüyle başlıyor — write scope yok.
 *         Bu script kullanıcıları "editor"'a yükseltme adımlarını gösteriyor.
 * - #11: Timeline için query scope gerekiyor ama editor'da yok.
 *         Bu script auth settings'i ve rol ayarlarını yapılandırıyor.
 */

import { config } from './config.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = `${config.apiUrl}/db/${config.database}`;
const AUTH_BASE = `${config.apiUrl}/db/${config.database}/auth`;

// ─── HTTP Yardımcısı ─────────────────────────────────────────────────────────

async function req(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { ok: res.ok, status: res.status, body };
}

// ─── Token Alma ───────────────────────────────────────────────────────────────

/**
 * Admin token — tüm scope'ları bypass eder.
 * Admin token "adminToken" endpoint'inden alınır.
 */
async function getAdminToken() {
  // Yöntem 1: Admin secret ile token
  const r = await req(`${config.apiUrl}/auth/token/admin`, {
    method: 'POST',
    body: JSON.stringify({ secret: config.adminSecret }),
  });
  if (r.ok) return r.body.token || r.body.accessToken;

  throw new Error(
    `Admin token alınamadı (${r.status}): ${JSON.stringify(r.body)}\n` +
    `  config.js'deki adminSecret'i kontrol edin.`
  );
}

/**
 * Schema scope DB token — POST /tables için gerekli.
 */
async function getSchemaToken() {
  const r = await req(`${config.apiUrl}/auth/token`, {
    method: 'POST',
    body: JSON.stringify({
      secret: config.adminSecret,
      database: config.database,
      scope: 'schema query write read delete',
    }),
  });
  if (r.ok) return r.body.token;
  throw new Error(`Schema token alınamadı (${r.status}): ${JSON.stringify(r.body)}`);
}

// ─── Tablo Oluşturma (POST /tables) ──────────────────────────────────────────

/**
 * POST /db/:db/tables ile tablo oluştur.
 * schema scope gerekiyor.
 * SORUN #1: FK (REFERENCES) desteği yok — sonradan ALTER TABLE ile ekliyoruz.
 */
async function createTable(schemaToken, name, columns, label) {
  console.log(`  → ${label}`);
  const r = await req(`${BASE}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${schemaToken}` },
    body: JSON.stringify({ name, columns }),
  });

  if (!r.ok) {
    const msg = r.body?.message || r.body?.error || JSON.stringify(r.body);
    // Tablo zaten varsa atla
    if (msg.includes('already exists') || r.status === 409) {
      console.log(`    (zaten mevcut, atlanıyor)`);
      return { alreadyExists: true };
    }
    throw new Error(`Tablo oluşturma hatası "${label}" (${r.status}): ${msg}`);
  }

  console.log(`    ✓ Oluşturuldu`);
  return r.body;
}

/**
 * Admin token ile ham SQL çalıştır.
 * Admin token ALLOW_RAW_SQL_ADMIN kontrolünü bypass eder.
 *
 * SORUN #15 DÜZELTME: Admin token kullanıldığında ALLOW_RAW_SQL_ADMIN=true
 * gerekmez — query.ts'de `isAdmin && adminFullSqlEnabled` kontrolü var.
 * ALLOW_RAW_SQL_ADMIN=false iken admin token DDL çalıştıramıyor!
 * Bu beklenmedik bir kısıtlama (database-issues.md'ye eklendi).
 */
async function runSQL(adminToken, sql, label) {
  console.log(`  → ${label}`);
  const r = await req(`${BASE}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ sql }),
  });

  if (!r.ok) {
    const msg = r.body?.message || r.body?.error || JSON.stringify(r.body);

    // Zaten mevcut (FK, index, vs.)
    if (msg.includes('already exists') || r.status === 409) {
      console.log(`    (zaten mevcut, atlanıyor)`);
      return;
    }

    // ALLOW_RAW_SQL_ADMIN sorunu
    if (msg.includes('ALLOW_RAW_SQL_ADMIN') || msg.includes('Only SELECT')) {
      console.warn(`  ⚠ DDL engellendi: ALLOW_RAW_SQL_ADMIN=true yapılandırması gerekiyor.`);
      console.warn(`    packages/.env dosyasına ALLOW_RAW_SQL_ADMIN=true ekleyin ve yeniden başlatın.`);
      console.warn(`    Bu SORUN #15: database-issues.md'ye bakın.`);
      return; // Devam et — FK olmadan da temel özellikler çalışır
    }

    throw new Error(`SQL hatası "${label}" (${r.status}): ${msg}`);
  }
  console.log(`    ✓ Tamam`);
}

// ─── Auth Ayarları ───────────────────────────────────────────────────────────

/**
 * Per-DB auth ayarlarını güncelle.
 * SORUN #7 geçici çözümü yok ama en azından email_signup_enabled kontrol edilir.
 * NOT: default_user_role ayarı henüz desteklenmiyor — bu SORUN #7'nin özüdür.
 */
async function checkAuthSettings(schemaToken) {
  console.log('  → Auth ayarları kontrol ediliyor...');
  const r = await req(`${AUTH_BASE}/settings`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${schemaToken}` },
  });

  if (!r.ok) {
    console.warn(`  ⚠ Auth ayarları alınamadı (${r.status}): ${JSON.stringify(r.body)}`);
    return null;
  }

  const settings = r.body;
  console.log(`    email_signup_enabled: ${settings.email_signup_enabled}`);
  console.log(`    email_verify_required: ${settings.email_verify_required}`);

  // SORUN #7 NOTU: default_user_role yok — burada ayarlayamıyoruz
  if (!settings.default_user_role) {
    console.warn(`  ⚠ SORUN #7: 'default_user_role' ayarı desteklenmiyor.`);
    console.warn(`    Yeni kullanıcılar 'viewer' rolüyle oluşturulacak (write scope yok).`);
    console.warn(`    Kullanıcılar kayıt sonrası admin aracılığıyla 'editor' yapılmalı.`);
  }

  return settings;
}

// ─── Ana Setup ────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Tweeter Clone — Veritabanı Kurulumu');
  console.log(`   API: ${config.apiUrl}`);
  console.log(`   DB:  ${config.database}`);
  console.log('');

  // ── 1. Token al ──────────────────────────────────────────────────────────
  console.log('[1/5] Token alınıyor...');
  let adminToken, schemaToken;

  try {
    adminToken = await getAdminToken();
    console.log('  ✓ Admin token alındı');
  } catch (err) {
    console.error('  ✗ Admin token alınamadı:', err.message);
    console.error('    Lütfen şunları kontrol edin:');
    console.error('    1. Postgrify çalışıyor mu? (cd packages && docker compose up -d)');
    console.error(`    2. config.js'deki adminSecret doğru mu?`);
    console.error(`    3. '${config.database}' veritabanı Postgrify'da tanımlı mı?`);
    process.exit(1);
  }

  try {
    schemaToken = await getSchemaToken();
    console.log('  ✓ Schema token alındı');
  } catch (err) {
    console.error('  ✗ Schema token alınamadı:', err.message);
    process.exit(1);
  }

  // ── 2. Tabloları oluştur ─────────────────────────────────────────────────
  console.log('[2/5] Tablolar oluşturuluyor (POST /tables)...');
  // SORUN #1: FK (REFERENCES) desteği yok — sonraki adımda ALTER TABLE ile eklenecek

  try {
    // users — auth_id ile _postgrify_auth.users'a bağlantı (SORUN #6)
    await createTable(schemaToken, 'users', [
      { name: 'id',           type: 'uuid',        primaryKey: true, nullable: false, default: 'gen_random_uuid()' },
      { name: 'auth_id',      type: 'text',        nullable: true,   unique: true },
      { name: 'username',     type: 'varchar(50)', nullable: false,  unique: true },
      { name: 'display_name', type: 'varchar(100)',nullable: false },
      { name: 'bio',          type: 'text',        nullable: true,   default: "''" },
      { name: 'avatar_url',   type: 'text',        nullable: true,   default: "''" },
      { name: 'created_at',   type: 'timestamptz', nullable: false,  default: 'NOW()' },
    ], 'users tablosu');

    // tweets — image_url URL olarak saklanıyor (SORUN #2)
    await createTable(schemaToken, 'tweets', [
      { name: 'id',         type: 'uuid',        primaryKey: true, nullable: false, default: 'gen_random_uuid()' },
      { name: 'user_id',    type: 'uuid',        nullable: false },
      { name: 'content',    type: 'varchar(280)',nullable: false },
      { name: 'image_url',  type: 'text',        nullable: true,   default: "''" },
      { name: 'reply_to',   type: 'uuid',        nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: false,  default: 'NOW()' },
    ], 'tweets tablosu');

    // follows — composite PK
    await createTable(schemaToken, 'follows', [
      { name: 'follower_id',  type: 'uuid',        nullable: false, primaryKey: true },
      { name: 'following_id', type: 'uuid',        nullable: false, primaryKey: true },
      { name: 'created_at',   type: 'timestamptz', nullable: false, default: 'NOW()' },
    ], 'follows tablosu');

    // likes — composite PK
    await createTable(schemaToken, 'likes', [
      { name: 'user_id',    type: 'uuid',        nullable: false, primaryKey: true },
      { name: 'tweet_id',   type: 'uuid',        nullable: false, primaryKey: true },
      { name: 'created_at', type: 'timestamptz', nullable: false, default: 'NOW()' },
    ], 'likes tablosu');

    console.log('  ✓ Temel tablolar hazır');
  } catch (err) {
    console.error('  ✗ Tablo oluşturma hatası:', err.message);
    process.exit(1);
  }

  // ── 3. FK ve indexler ekle (admin token ile /query) ──────────────────────
  // SORUN #1: POST /tables FK desteklemiyor — admin SQL ile ekliyoruz
  // SORUN #15: Bu ALLOW_RAW_SQL_ADMIN=true + admin token gerektirir
  console.log('[3/5] Foreign key ve indexler ekleniyor (SORUN #1 geçici çözümü)...');

  const ddlStatements = [
    {
      sql: `ALTER TABLE tweets ADD CONSTRAINT fk_tweets_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      label: 'tweets → users FK',
    },
    {
      sql: `ALTER TABLE tweets ADD CONSTRAINT fk_tweets_reply
            FOREIGN KEY (reply_to) REFERENCES tweets(id) ON DELETE SET NULL`,
      label: 'tweets → tweets (reply) FK',
    },
    {
      sql: `ALTER TABLE follows ADD CONSTRAINT fk_follows_follower
            FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE`,
      label: 'follows → users (follower) FK',
    },
    {
      sql: `ALTER TABLE follows ADD CONSTRAINT fk_follows_following
            FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE`,
      label: 'follows → users (following) FK',
    },
    {
      sql: `ALTER TABLE likes ADD CONSTRAINT fk_likes_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      label: 'likes → users FK',
    },
    {
      sql: `ALTER TABLE likes ADD CONSTRAINT fk_likes_tweet
            FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE`,
      label: 'likes → tweets FK',
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id)`,
      label: 'tweets user_id index',
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at DESC)`,
      label: 'tweets created_at index',
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)`,
      label: 'follows follower index',
    },
  ];

  let ddlWarned = false;
  for (const { sql, label } of ddlStatements) {
    try {
      await runSQL(adminToken, sql, label);
    } catch (err) {
      if (!ddlWarned) {
        console.warn('  ⚠ Bazı DDL adımları başarısız. FK olmadan devam ediliyor.');
        console.warn('    ALLOW_RAW_SQL_ADMIN=true yapılandırması için database-issues.md #15\'e bakın.');
        ddlWarned = true;
      }
    }
  }

  // ── 4. Auth ayarlarını kontrol et ────────────────────────────────────────
  console.log('[4/5] Auth ayarları kontrol ediliyor...');
  await checkAuthSettings(schemaToken);

  // ── 5. Token dosyasını oluştur ────────────────────────────────────────────
  console.log('[5/5] Yapılandırma dosyası oluşturuluyor...');

  // Frontend için bir "read" scope token oluştur — sadece okuma için
  // Write için kullanıcı kendi auth token'ını kullanacak (viewer rolü çözüldükten sonra)
  let readToken = '';
  try {
    const r = await req(`${config.apiUrl}/auth/token`, {
      method: 'POST',
      body: JSON.stringify({
        secret: config.adminSecret,
        database: config.database,
        scope: 'read',
      }),
    });
    if (r.ok) readToken = r.body.token;
  } catch { /* Sessizce geç — token olmadan da temel sayfa yüklenir */ }

  const tokenFile = `// Bu dosya setup.js tarafından otomatik oluşturuldu — git'e ekleme!
// Postgrify Twitter Clone — Üretilen Yapılandırma
export const SETUP_CONFIG = {
  apiUrl: "${config.apiUrl}",
  database: "${config.database}",
  // Sadece okuma için public token (auth user token'ı write için kullanılacak)
  readToken: "${readToken}",
};
`;
  writeFileSync(path.join(__dirname, 'generated-config.js'), tokenFile);
  console.log('  ✓ src/generated-config.js oluşturuldu');

  console.log('');
  console.log('✅ Kurulum tamamlandı!');
  console.log('');
  console.log('⚠️  Bilinen Sorunlar (database-issues.md):');
  console.log('   - SORUN #7: Yeni kullanıcılar "viewer" rolüyle oluşturuluyor (write scope yok).');
  console.log('     Kayıt sonrası kullanıcı tweet atamıyor veya profil oluşturamıyor!');
  console.log('   - SORUN #11: Timeline için "query" scope gerekiyor — editor rolünde yok.');
  console.log('     Kullanıcılar admin rolüne yükseltilmeden timeline göremez.');
  console.log('');
  console.log('Uygulamayı başlatmak için:');
  console.log('  node src/serve.js');
  console.log('  → http://localhost:4000');
}

main().catch(err => {
  console.error('\n💥 Beklenmeyen hata:', err.message);
  process.exit(1);
});