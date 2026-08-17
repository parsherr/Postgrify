/**
 * Auth Schema Provisioner — lazily creates the _postgrify_auth schema for each managed DB.
 *
 * Idempotent: uses IF NOT EXISTS + ADD COLUMN IF NOT EXISTS so it can be
 * called multiple times without touching existing data.
 *
 * Tables:
 *   users           — authentication users
 *   sessions        — refresh tokens (PostgreSQL-native, no Redis required)
 *   audit_log       — record of all auth events
 *   oauth_providers — per-DB OAuth client_id/secret configuration
 *   auth_settings   — per-DB feature flags (is signup open, is magic link enabled, etc.)
 */

import type postgres from "postgres";

export async function ensureAuthSchema(sql: postgres.Sql, _dbName?: string): Promise<void> {
  // ── Base tables ──────────────────────────────────────────────────────────
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS _postgrify_auth;

    -- Primary user table
    CREATE TABLE IF NOT EXISTS _postgrify_auth.users (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email             TEXT        UNIQUE NOT NULL,
      password_hash     TEXT,                          -- NULL: for OAuth-only users
      role              TEXT        NOT NULL DEFAULT 'viewer'
                                      CHECK (role IN ('viewer', 'editor', 'admin')),
      is_active         BOOLEAN     NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login        TIMESTAMPTZ,
      metadata          JSONB       NOT NULL DEFAULT '{}',
      -- Email verification
      email_verified    BOOLEAN     NOT NULL DEFAULT false,
      -- Profile (also populated from OAuth)
      full_name         TEXT,
      avatar_url        TEXT,
      -- Provider information
      provider          TEXT        NOT NULL DEFAULT 'email',
      provider_id       TEXT                            -- Unique ID from the OAuth provider
    );

    -- Session / refresh token table
    CREATE TABLE IF NOT EXISTS _postgrify_auth.sessions (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID        NOT NULL
                                  REFERENCES _postgrify_auth.users(id) ON DELETE CASCADE,
      refresh_token TEXT        UNIQUE NOT NULL,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked       BOOLEAN     NOT NULL DEFAULT false,
      revoked_at    TIMESTAMPTZ,
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

    -- Per-DB OAuth provider configuration
    CREATE TABLE IF NOT EXISTS _postgrify_auth.oauth_providers (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      provider      TEXT        NOT NULL UNIQUE,
      client_id     TEXT        NOT NULL,
      client_secret TEXT        NOT NULL,
      redirect_uri  TEXT        NOT NULL,
      enabled       BOOLEAN     NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Per-DB auth settings (key-value)
    CREATE TABLE IF NOT EXISTS _postgrify_auth.auth_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Indexes
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

  // ── Add new columns to existing DBs (idempotent ALTER) ──────────────────
  // Older installations are updated via IF NOT EXISTS ALTER statements.
  await sql.unsafe(`
    ALTER TABLE _postgrify_auth.users
      ADD COLUMN IF NOT EXISTS email_verified   BOOLEAN     NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS full_name         TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url        TEXT,
      ADD COLUMN IF NOT EXISTS provider          TEXT        NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS provider_id       TEXT,
      ADD COLUMN IF NOT EXISTS failed_attempts   INTEGER     NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until      TIMESTAMPTZ;

    ALTER TABLE _postgrify_auth.sessions
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

    -- Remove the NOT NULL constraint on password_hash (for OAuth users)
    -- This only runs when the constraint exists; since there is no IF NOT EXISTS,
    -- it may throw — we wrap it with try/catch (in the provision.ts caller).
  `).catch(() => {
    // Ignore ALTER TABLE errors — the column already exists or the constraint did not change
  });

  // Load default auth settings (INSERT OR IGNORE)
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
      -- Default role for new users.
      -- Values: 'viewer' (read-only), 'editor' (read+write+delete+query), 'admin' (full access)
      -- App developers can set this to 'editor' so new users can
      -- post tweets, create profiles, etc. (Issue #7 fix)
      ('default_user_role',          'viewer')
    ON CONFLICT (key) DO NOTHING;
  `);
}

/**
 * Inserts an audit log entry. Silently continues on error (must not interrupt auth flow).
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
    // An audit log error must not interrupt the auth flow
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
  | "account_deleted"
  | "refresh_token_reuse"
  | "generate_link"
  | "user_ban";

/**
 * Reads a per-DB auth setting. Returns the default value if not found.
 *
 * The returned value is normalized to lowercase — comparisons are case-insensitive.
 * e.g. "TRUE", "True", and "true" stored in the DB are all treated the same way.
 * This normalization eliminates the risk of bypass in boolean flag comparisons.
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
 * Returns the database's API key.
 * Returns null if the schema has not been provisioned yet.
 */
export async function getApiKey(sql: postgres.Sql): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT value FROM _postgrify_auth.auth_settings WHERE key = 'api_key'
    `;
    const key = rows[0]?.value as string | undefined;
    return key ?? null;
  } catch {
    // Table not yet created
    return null;
  }
}

/**
 * Creates and saves the api_key during the first provision.
 * Returns the existing key if already present (idempotent).
 * Calls ensureAuthSchema — works even if not yet provisioned.
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