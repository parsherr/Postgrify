/**
 * DB Auth User CRUD routes.
 *
 * All endpoints require an admin token or a DB token with the appropriate scope.
 * password_hash is never included in responses.
 *
 *   GET    /:database/auth/users              — list users
 *   POST   /:database/auth/users              — create user
 *   PATCH  /:database/auth/users/:id          — update email / role / is_active
 *   DELETE /:database/auth/users/:id          — delete user
 *   POST   /:database/auth/users/:id/reset-password — reset password
 */

import type { FastifyInstance } from "fastify";

/**
 * Sensitive keys that must never be returned in API responses.
 *
 * These fields are stored in users.metadata JSONB for operational purposes
 * (password reset, email verification, magic link), but exposing them would
 * let anyone with admin API access bypass those flows entirely.
 */
const SENSITIVE_METADATA_KEYS = [
  "reset_token",
  "reset_token_expires",
  // magicLink.ts stores under magic_link_token
  "magic_link_token",
  "magic_link_token_expires",
  // kept for backward compat in case any prior data used these keys
  "magic_token",
  "magic_token_expires",
  "verification_token",
  "verification_token_expires",
];

/**
 * Strips sensitive internal fields from a user's metadata object.
 * Returns null when metadata is null/undefined to preserve the original type.
 */
function stripSensitiveMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const cleaned = { ...(metadata as Record<string, unknown>) };
  for (const key of SENSITIVE_METADATA_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

/** Applies stripSensitiveMetadata to a user row returned from the DB. */
function sanitizeUser(user: Record<string, unknown>): Record<string, unknown> {
  if (!user.metadata) return user;
  return { ...user, metadata: stripSensitiveMetadata(user.metadata) };
}
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { hashPassword, verifyPassword } from "../../../services/passwordService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import { ensureAuthSchema } from "./provision.js";

// authenticate + scopeGuard are used together on users routes
// This helper shortens the preHandler array on each endpoint
function authGuard(server: FastifyInstance, scope: Parameters<typeof scopeGuard>[0]) {
  return [server.authenticate, scopeGuard(scope)] as const;
}

export async function authUsersRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);
  // ── GET /:database/auth/users (C-17 pagination + filters) ─────────────────
  server.get(
    "/:database/auth/users",
    {
      preHandler: [...authGuard(server, "read")],
      schema: {
        description:
          "List auth users (C-17). Supports page/per_page and email/role/is_active filters.",
        tags: ["db-auth"],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            per_page: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            email: { type: "string" },
            role: { type: "string", enum: ["viewer", "editor", "admin"] },
            is_active: { type: "boolean" },
            created_after: { type: "string", format: "date-time" },
            created_before: { type: "string", format: "date-time" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const q = req.query as {
        page?: number;
        per_page?: number;
        email?: string;
        role?: string;
        is_active?: boolean;
        created_after?: string;
        created_before?: string;
      };
      const page = Math.max(1, q.page ?? 1);
      const perPage = Math.min(100, Math.max(1, q.per_page ?? 50));
      const offset = (page - 1) * perPage;

      let where = sql`TRUE`;
      if (q.email) {
        where = sql`${where} AND email ILIKE ${"%" + q.email + "%"}`;
      }
      if (q.role) {
        where = sql`${where} AND role = ${q.role}`;
      }
      if (q.is_active !== undefined) {
        where = sql`${where} AND is_active = ${q.is_active}`;
      }
      if (q.created_after) {
        where = sql`${where} AND created_at >= ${q.created_after}`;
      }
      if (q.created_before) {
        where = sql`${where} AND created_at <= ${q.created_before}`;
      }

      const [countRow] = await sql`
        SELECT count(*)::int AS total
        FROM _postgrify_auth.users
        WHERE ${where}
      `;
      const total = Number(countRow?.total ?? 0);
      const lastPage = Math.max(1, Math.ceil(total / perPage));

      const users = await sql`
        SELECT id, email, role, is_active, created_at, last_login, email_verified, full_name,
               ((CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)
                 - 'reset_token' - 'reset_token_exp'
                 - 'magic_token' - 'magic_token_exp'
                 - 'verification_token' - 'verification_exp') AS metadata
        FROM _postgrify_auth.users
        WHERE ${where}
        ORDER BY created_at ASC
        LIMIT ${perPage} OFFSET ${offset}
      `;

      return reply.send({
        users: users.map((u) => sanitizeUser(u as Record<string, unknown>)),
        aud: "authenticated",
        total,
        page,
        per_page: perPage,
        next_page: page < lastPage ? page + 1 : null,
        last_page: lastPage,
      });
    })
  );

  // ── POST /:database/auth/users ─────────────────────────────────────────────
  server.post(
    "/:database/auth/users",
    {
      preHandler: [...authGuard(server, "write")],
      schema: {
        description: "Create a new auth user for this database",
        tags: ["db-auth"],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email:    { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            role: {
              type: "string",
              enum: ["viewer", "editor", "admin"],
              default: "viewer",
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { email, password, role = "viewer" } = req.body as {
        email: string;
        password: string;
        role?: string;
      };

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const passwordHash = await hashPassword(password);

      const [user] = await sql`
        INSERT INTO _postgrify_auth.users (email, password_hash, role)
        VALUES (${email}, ${passwordHash}, ${role})
        RETURNING id, email, role, is_active, created_at, last_login,
                  (metadata - 'reset_token' - 'reset_token_exp'
                            - 'magic_token' - 'magic_token_exp') AS metadata
      `;

      return reply.status(201).send(sanitizeUser(user as Record<string, unknown>));
    })
  );

  // ── PATCH /:database/auth/users/:id (C-18) ────────────────────────────────
  server.patch(
    "/:database/auth/users/:id",
    {
      preHandler: [...authGuard(server, "write")],
      schema: {
        description:
          "Update auth user (C-18): email/role/is_active, email_confirm, ban_duration, metadata, password",
        tags: ["db-auth"],
        body: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["viewer", "editor", "admin"] },
            is_active: { type: "boolean" },
            full_name: { type: "string" },
            email_confirm: { type: "boolean" },
            ban_duration: { type: "string", description: 'e.g. "24h", "72h", or "none" to unban' },
            password: { type: "string", minLength: 8 },
            user_metadata: { type: "object", additionalProperties: true },
            app_metadata: { type: "object", additionalProperties: true },
            metadata: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        email?: string;
        role?: string;
        is_active?: boolean;
        full_name?: string;
        email_confirm?: boolean;
        ban_duration?: string;
        password?: string;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      };

      if (Object.keys(body).length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (body.email !== undefined) {
        setClauses.push(`email = $${paramIndex++}`);
        values.push(body.email.toLowerCase());
      }
      if (body.role !== undefined) {
        setClauses.push(`role = $${paramIndex++}`);
        values.push(body.role);
      }
      if (body.is_active !== undefined) {
        setClauses.push(`is_active = $${paramIndex++}`);
        values.push(body.is_active);
      }
      if (body.full_name !== undefined) {
        setClauses.push(`full_name = $${paramIndex++}`);
        values.push(body.full_name);
      }
      if (body.email_confirm === true) {
        setClauses.push(`email_verified = TRUE`);
      }
      if (body.ban_duration !== undefined) {
        if (body.ban_duration === "none" || body.ban_duration === "0") {
          setClauses.push(`locked_until = NULL`);
        } else {
          const match = body.ban_duration.match(/^(\d+)([smhd])$/);
          if (!match) {
            return reply.status(400).send({
              error: "Invalid ban_duration (use e.g. 24h, 72h, or none)",
            });
          }
          const n = parseInt(match[1], 10);
          const mult: Record<string, number> = {
            s: 1000,
            m: 60_000,
            h: 3_600_000,
            d: 86_400_000,
          };
          const until = new Date(Date.now() + n * (mult[match[2]] ?? 3_600_000)).toISOString();
          setClauses.push(`locked_until = $${paramIndex++}`);
          values.push(until);
        }
      }
      if (body.password !== undefined) {
        const passwordHash = await hashPassword(body.password);
        setClauses.push(`password_hash = $${paramIndex++}`);
        values.push(passwordHash);
      }

      // metadata merges
      const metaUpdates: Record<string, unknown> = {};
      if (body.user_metadata) Object.assign(metaUpdates, body.user_metadata);
      if (body.metadata) Object.assign(metaUpdates, body.metadata);
      if (body.app_metadata) {
        metaUpdates.app_metadata = body.app_metadata;
      }
      if (Object.keys(metaUpdates).length > 0) {
        setClauses.push(
          `metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIndex++}::jsonb`
        );
        values.push(JSON.stringify(metaUpdates));
      }

      if (setClauses.length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      values.push(id);
      const setStr = setClauses.join(", ");

      const rows = await sql.unsafe(
        `UPDATE _postgrify_auth.users
         SET ${setStr}
         WHERE id = $${paramIndex}
         RETURNING id, email, role, is_active, created_at, last_login, email_verified, full_name, locked_until,
                   (metadata - 'reset_token' - 'reset_token_exp'
                             - 'magic_token' - 'magic_token_exp'
                             - 'verification_token' - 'verification_exp') AS metadata`,
        values as Parameters<typeof sql.unsafe>[1]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      if (body.password !== undefined) {
        await sql`
          UPDATE _postgrify_auth.sessions
          SET revoked = true, revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${id} AND revoked = false
        `;
      }

      return reply.send(sanitizeUser(rows[0] as Record<string, unknown>));
    })
  );

  // ── DELETE /:database/auth/users/:id ──────────────────────────────────────
  server.delete(
    "/:database/auth/users/:id",
    {
      preHandler: [...authGuard(server, "delete")],
      schema: {
        description: "Delete an auth user",
        tags: ["db-auth"],
      },
    },
    asyncHandler(async (req, reply) => {
      const { id } = req.params as { id: string };
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const rows = await sql`
        DELETE FROM _postgrify_auth.users
        WHERE id = ${id}
        RETURNING id
      `;

      if (rows.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.status(204).send();
    })
  );

  // ── POST /:database/auth/users/:id/reset-password ─────────────────────────
  server.post(
    "/:database/auth/users/:id/reset-password",
    {
      preHandler: [...authGuard(server, "write")],
      schema: {
        description: "Reset the password of an auth user",
        tags: ["db-auth"],
        body: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", minLength: 8 },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { id } = req.params as { id: string };
      const { password } = req.body as { password: string };

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const passwordHash = await hashPassword(password);

      const rows = await sql`
        UPDATE _postgrify_auth.users
        SET password_hash = ${passwordHash}
        WHERE id = ${id}
        RETURNING id, email
      `;

      if (rows.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Revoke all existing sessions (security: old tokens must be invalidated after a password change)
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE user_id = ${id} AND revoked = false
      `;

      return reply.send({ ok: true, message: "Password updated. All existing sessions revoked." });
    })
  );

  // ── PATCH /:database/auth/me/password ─────────────────────────────────────
  server.patch(
    "/:database/auth/me/password",
    {
      preHandler: [server.authenticate],
      schema: {
        description: "Change own password (DB user self-service). Revokes all other active sessions.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1 },
            newPassword:     { type: "string", minLength: 8 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok:      { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
    // Editors can change their own password — no schema scope required
      const authHeader = req.headers.authorization;
      const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!rawToken) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const dbUserPayload = await jwtService.verifyDbUser(rawToken);
      if (!dbUserPayload) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "This endpoint requires a per-database user token, not an admin token",
        });
      }

      const userId = dbUserPayload.sub;
      const database = req.dbName!;

    // Must be admin or the user themselves
      if (dbUserPayload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Verify the current password
      const [user] = await sql`
        SELECT password_hash FROM _postgrify_auth.users
        WHERE id = ${userId} AND is_active = true
      `;

      if (!user) {
        return reply.status(404).send({ error: "User not found or disabled" });
      }

      const valid = await verifyPassword(user.password_hash as string, currentPassword);
      if (!valid) {
        return reply.status(401).send({ error: "Current password is incorrect" });
      }

      const newHash = await hashPassword(newPassword);

      await sql`
        UPDATE _postgrify_auth.users
        SET password_hash = ${newHash}
        WHERE id = ${userId}
      `;

        // Revoke all of the user's sessions
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE user_id = ${userId} AND revoked = false
      `;

      return reply.send({ ok: true, message: "Password updated. All other sessions revoked." });
    })
  );

  // ── DELETE /:database/auth/me ──────────────────────────────────────────────
        // Swallow session revocation errors — the main delete is the priority
    // A user cannot delete themselves (admin should not delete their own account either)
        // Revoke all sessions for the target user
  server.delete(
    "/:database/auth/me",
    {
      schema: {
        description:
          "Delete the currently authenticated user's own account. " +
          "Requires a per-database user token (not an admin token). " +
          "All sessions are revoked and the user record is permanently deleted.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        // body schema yok — DELETE /auth/me body gerektirmez.
        // Revoke all sessions for the target user
        response: {
          200: {
            type: "object",
            properties: {
              ok:      { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const authHeader = req.headers.authorization;
      const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!rawToken) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

    // Perform the delete
      // because an admin token does not belong to a "user"; it is unclear which user should be deleted.
      const dbUserPayload = await jwtService.verifyDbUser(rawToken);
      if (!dbUserPayload) {
        return reply.status(403).send({
          error: "Forbidden",
          message:
            "DELETE /auth/me requires a per-database user token. " +
            "Use DELETE /auth/users/:id with an admin token to delete other users.",
        });
      }

      const userId = dbUserPayload.sub;
      const database = req.dbName!;

      if (dbUserPayload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Password verification (optional — check only if provided)
      const { password: confirmPassword } = (req.body ?? {}) as { password?: string };
      if (confirmPassword) {
        const [user] = await sql`
          SELECT password_hash FROM _postgrify_auth.users
          WHERE id = ${userId} AND is_active = true
        `;
        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }
        const { verifyPassword: verify } = await import("../../../services/passwordService.js");
        const valid = await verify(user.password_hash as string, confirmPassword);
        if (!valid) {
          return reply.status(401).send({ error: "Incorrect password" });
        }
      }

      // Revoke all sessions, then delete the user (CASCADE also deletes sessions)
      await sql`
        UPDATE _postgrify_auth.sessions SET revoked = true WHERE user_id = ${userId}
      `;
      await sql`
        DELETE FROM _postgrify_auth.users WHERE id = ${userId}
      `;

      return reply.send({ ok: true, message: "Account deleted successfully." });
    })
  );
}