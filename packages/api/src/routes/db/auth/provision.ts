/**
 * Auth Schema Provisioner — her managed DB'ye _postgrify_auth schema'sını lazily oluşturur.
 *
 * Idempotent: IF NOT EXISTS + ADD COLUMN IF NOT EXISTS kullanıldığından
 * defalarca çağrılabilir, mevcut veriye dokunmaz.
 *
 * Tablolar:
 *   users          — kimlik doğrulama kullanıcıları
 *   sessions       — refresh token'lar (PostgreSQL-native, Redis'e gerek yok)
 *   audit_log      — tüm auth eventlarının kaydı
 *   oauth_providers — per-DB OAuth client_id/secret yapılandırması
 *   auth_settings  — per-DB feature flag'leri (signup açık mı, magic link var mı vb.)
 */

import type postgres from "postgres";

export async function ensureAuthSchema(sql: postgres.Sql, _dbName?: string): Promise<void> {
  // ── Temel tablolar ───────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS _postgrify_auth;

    -- Ana kullanıcı tablosu
    CREATE TABLE IF NOT EXISTS _postgrify_auth.users (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email             TEXT        UNIQUE NOT NULL,
      password_hash     TEXT,                          -- NULL: OAuth-only kullanıcılar için
      role              TEXT        NOT NULL DEFAULT 'viewer'
                                      CHECK (role IN ('viewer', 'editor', 'admin')),
      is_active         BOOLEAN     NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login        TIMESTAMPTZ,
      metadata          JSONB       NOT NULL DEFAULT '{}',
      -- Email doğrulama
      email_verified    BOOLEAN     NOT NULL DEFAULT false,
      -- Profil (OAuth'dan da doldurulur)
      full_name         TEXT,
      avatar_url        TEXT,
      -- Provider bilgisi
      provider          TEXT        NOT NULL DEFAULT 'email',
      provider_id       TEXT                            -- OAuth provider'dan gelen benzersiz ID
    );

    -- Session / refresh token tablosu
    CREATE TABLE IF NOT EXISTS _postgrify_auth.sessions (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID        NOT NULL
                                  REFERENCES _postgrify_auth.users(id) ON DELETE CASCADE,
      refresh_token TEXT        UNIQUE NOT NULL,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked       BOOLEAN     NOT NULL DEFAULT false,
      ip            TEXT,
      user_agent    TEXT
    );

    -- Audit log
    CREATE TABLE IF NOT EXISTS _postgrify_auth.audit_log (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        REFERENCES _postgrify_auth.users(id) ON DELETE SET NULL,
      event      TEXT        NOT NULL,
      ip         TEXT,
      user_agent TEXT,
      metadata   JSONB       NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Per-DB OAuth provider yapılandırması
    CREATE TABLE IF NOT EXISTS _postgrify_auth.oauth_providers (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      provider      TEXT        NOT NULL UNIQUE,
      client_id     TEXT        NOT NULL,
      client_secret TEXT        NOT NULL,
      redirect_uri  TEXT        NOT NULL,
      enabled       BOOLEAN     NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Per-DB auth ayarları (key-value)
    CREATE TABLE IF NOT EXISTS _postgrify_auth.auth_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- İndeksler
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_token
      ON _postgrify_auth.sessions (refresh_token)
      WHERE revoked = false;

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
      ON _postgrify_auth.sessions (user_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id
      ON _postgrify_auth.audit_log (user_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
      ON _postgrify_auth.audit_log (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_users_provider
      ON _postgrify_auth.users (provider, provider_id)
      WHERE provider_id IS NOT NULL;
  `);

  // ── Mevcut DB'lere yeni kolonları ekle (idempotent ALTER) ────────────────
  // Eski kurulumlar IF NOT EXISTS'li ALTER'larla güncellenir.
  await sql.unsafe(`
    ALTER TABLE _postgrify_auth.users
      ADD COLUMN IF NOT EXISTS email_verified   BOOLEAN     NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS full_name         TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url        TEXT,
      ADD COLUMN IF NOT EXISTS provider          TEXT        NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS provider_id       TEXT,
      ADD COLUMN IF NOT EXISTS failed_attempts   INTEGER     NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until      TIMESTAMPTZ;

    -- password_hash NOT NULL kısıtını kaldır (OAuth kullanıcıları için)
    -- Bu sadece mevcut kısıt varsa çalışır; IF NOT EXISTS olmadığı için
    -- hata fırlatabilir — try/catch ile sarıyoruz (provision.ts caller'da).
  `).catch(() => {
    // ALTER TABLE hatalarını yoksay — kolon zaten var ya da kısıt değişmedi
  });

  // Varsayılan auth ayarlarını yükle (INSERT OR IGNORE)
  await sql.unsafe(`
    INSERT INTO _postgrify_auth.auth_settings (key, value) VALUES
      ('email_signup_enabled',       'true'),
      ('magic_link_enabled',         'false'),
      ('email_verify_required',      'false'),
      ('oauth_enabled',              'false'),
      ('signup_redirect_url',        ''),
      ('token_expiry',               '15m'),
      ('refresh_token_expiry',       '7d'),
      ('min_password_length',        '8'),
      ('password_require_uppercase', 'false'),
      ('password_require_number',    'false'),
      ('password_require_special',   'false'),
      ('account_lockout_attempts',   '5'),
      ('account_lockout_minutes',    '15'),
      -- Yeni kullanıcıların varsayılan rolü.
      -- Değerler: 'viewer' (sadece okuma), 'editor' (okuma+yazma+silme+sorgu), 'admin' (tam erişim)
      -- Uygulama geliştiricisi bunu 'editor' yaparak yeni kullanıcıların
      -- tweet atabilmesini, profil oluşturabilmesini sağlayabilir. (SORUN #7 düzeltmesi)
      ('default_user_role',          'viewer')
    ON CONFLICT (key) DO NOTHING;
  `);
}

/**
 * Audit log kaydı ekler. Hatada sessizce devam eder (auth flow'u kesmesin).
 */
export async function insertAuditLog(
  sql: postgres.Sql,
  event: AuditEvent,
  userId: string | null,
  extras: { ip?: string; userAgent?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await sql`
      INSERT INTO _postgrify_auth.audit_log (user_id, event, ip, user_agent, metadata)
      VALUES (
        ${userId},
        ${event},
        ${extras.ip ?? null},
        ${extras.userAgent ?? null},
        ${JSON.stringify(extras.metadata ?? {})}
      )
    `;
  } catch {
    // Audit log hatası auth flow'u kesmemeli
  }
}

export type AuditEvent =
  | "signup"
  | "login"
  | "logout"
  | "login_failed"
  | "password_reset_request"
  | "password_reset"
  | "magic_link_request"
  | "magic_link_login"
  | "email_verified"
  | "oauth_login"
  | "oauth_signup"
  | "account_disabled"
  | "password_changed"
  | "raw_sql_exec"
  | "account_deleted";

/**
 * Per-DB auth ayarını okur. Yoksa default değeri döner.
 */
/**
 * Per-DB auth ayarını okur. Yoksa default değeri döner.
 *
 * Dönen değer küçük harfe normalize edilir — karşılaştırmalar case-insensitive çalışır.
 * Örn: DB'de "TRUE", "True", "true" değerleri aynı şekilde değerlendirilir.
 * Bu normalizasyon boolean flag karşılaştırmalarında bypass riskini ortadan kaldırır.
 */
export async function getAuthSetting(
  sql: postgres.Sql,
  key: string,
  defaultValue: string = ""
): Promise<string> {
  const rows = await sql`
    SELECT value FROM _postgrify_auth.auth_settings WHERE key = ${key}
  `;
  const raw = (rows[0]?.value as string) ?? defaultValue;
  return raw.toLowerCase();
}

/**
 * Database'in API key'ini döner.
 * Schema henüz provision edilmemişse null döner.
 */
export async function getApiKey(sql: postgres.Sql): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT value FROM _postgrify_auth.auth_settings WHERE key = 'api_key'
    `;
    const key = rows[0]?.value as string | undefined;
    return key ?? null;
  } catch {
    // Tablo henüz oluşturulmamış
    return null;
  }
}

/**
 * İlk provision sırasında api_key oluşturur ve kaydeder.
 * Zaten varsa mevcut key'i döner (idempotent).
 * ensureAuthSchema çağırır — provision edilmemiş olsa bile çalışır.
 */
export async function provisionApiKey(sql: postgres.Sql): Promise<string> {
  await ensureAuthSchema(sql);
  const existing = await getApiKey(sql);
  if (existing) return existing;

  const { randomBytes } = await import("crypto");
  const newKey = randomBytes(32).toString("hex");

  await sql`
    INSERT INTO _postgrify_auth.auth_settings (key, value)
    VALUES ('api_key', ${newKey})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  return newKey;
}