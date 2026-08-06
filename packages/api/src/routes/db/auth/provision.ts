/**
 * Auth Schema Provisioner — her managed DB'ye _postgrify_auth schema'sını lazily oluşturur.
 *
 * Idempotent: IF NOT EXISTS kullanıldığından defalarca çağrılabilir, cost negligible.
 * Her auth endpoint handler'ının başında çağrılır.
 */

import type postgres from "postgres";

export async function ensureAuthSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS _postgrify_auth;

    CREATE TABLE IF NOT EXISTS _postgrify_auth.users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer'
                      CHECK (role IN ('viewer', 'editor', 'admin')),
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login    TIMESTAMPTZ,
      metadata      JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS _postgrify_auth.sessions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL
                      REFERENCES _postgrify_auth.users(id) ON DELETE CASCADE,
      refresh_token TEXT UNIQUE NOT NULL,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked       BOOLEAN NOT NULL DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_token
      ON _postgrify_auth.sessions (refresh_token)
      WHERE revoked = false;

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
      ON _postgrify_auth.sessions (user_id);
  `);
}