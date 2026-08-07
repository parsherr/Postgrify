/**
 * DB Auth User CRUD routes.
 *
 * Tüm endpoint'ler admin token veya uygun scope'a sahip DB token gerektirir.
 * password_hash hiçbir zaman response'a dahil edilmez.
 *
 *   GET    /:database/auth/users              — kullanıcı listesi
 *   POST   /:database/auth/users              — kullanıcı oluştur
 *   PATCH  /:database/auth/users/:id          — email / role / is_active güncelle
 *   DELETE /:database/auth/users/:id          — kullanıcı sil
 *   POST   /:database/auth/users/:id/reset-password — şifre sıfırla
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { hashPassword, verifyPassword } from "../../../services/passwordService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import { ensureAuthSchema } from "./provision.js";

// users route'larında authenticate + scopeGuard birlikte kullanılır
// Bu helper her endpoint'te preHandler dizisini kısaltır
function authGuard(server: FastifyInstance, scope: Parameters<typeof scopeGuard>[0]) {
  return [server.authenticate, scopeGuard(scope)] as const;
}

export async function authUsersRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);
  // ── GET /:database/auth/users ──────────────────────────────────────────────
  server.get(
    "/:database/auth/users",
    {
      preHandler: [...authGuard(server, "read")],
      schema: {
        description: "List all auth users for this database (password_hash excluded)",
        tags: ["db-auth"],
      },
    },
    asyncHandler(async (req, reply) => {
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const users = await sql`
        SELECT id, email, role, is_active, created_at, last_login, metadata
        FROM _postgrify_auth.users
        ORDER BY created_at ASC
      `;

      return reply.send({ users, total: users.length });
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
        RETURNING id, email, role, is_active, created_at, last_login, metadata
      `;

      return reply.status(201).send(user);
    })
  );

  // ── PATCH /:database/auth/users/:id ───────────────────────────────────────
  server.patch(
    "/:database/auth/users/:id",
    {
      preHandler: [...authGuard(server, "write")],
      schema: {
        description: "Update role or active status of an auth user",
        tags: ["db-auth"],
        body: {
          type: "object",
          properties: {
            email:     { type: "string", format: "email" },
            role:      { type: "string", enum: ["viewer", "editor", "admin"] },
            is_active: { type: "boolean" },
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
      };

      if (Object.keys(body).length === 0) {
        return reply.status(400).send({ error: "No fields to update" });
      }

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      // Dinamik SET kısmını güvenli şekilde oluştur
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (body.email !== undefined) {
        setClauses.push(`email = $${paramIndex++}`);
        values.push(body.email);
      }
      if (body.role !== undefined) {
        setClauses.push(`role = $${paramIndex++}`);
        values.push(body.role);
      }
      if (body.is_active !== undefined) {
        setClauses.push(`is_active = $${paramIndex++}`);
        values.push(body.is_active);
      }

      values.push(id);
      const setStr = setClauses.join(", ");

      const rows = await sql.unsafe(
        `UPDATE _postgrify_auth.users
         SET ${setStr}
         WHERE id = $${paramIndex}
         RETURNING id, email, role, is_active, created_at, last_login, metadata`,
        values as Parameters<typeof sql.unsafe>[1]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send(rows[0]);
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

      // Mevcut tüm session'ları revoke et (güvenlik: şifre değişince eski token'lar geçersiz)
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
      // Bu endpoint yalnızca per-DB user token'ı ile çağrılabilir
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

      // Token'ın bu DB için geçerli olduğunu kontrol et
      if (dbUserPayload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Mevcut şifreyi doğrula
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

      // Diğer tüm aktif session'ları revoke et (kendi token'ı hariç — o zaten kısa ömürlü)
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE user_id = ${userId} AND revoked = false
      `;

      return reply.send({ ok: true, message: "Password updated. All other sessions revoked." });
    })
  );
}