/**
 * GET /:database/auth/me — Geçerli DB kullanıcısının bilgilerini döner.
 *
 * Authorization: Bearer <db-user-access-token> gerektirir.
 * password_hash döndürülmez.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema } from "./provision.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";

export async function authMeRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  server.get(
    "/:database/auth/me",
    {
      schema: {
        description: "Get current DB user profile from access token.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              id:             { type: "string" },
              email:          { type: "string" },
              role:           { type: "string" },
              full_name:      { type: ["string", "null"] },
              avatar_url:     { type: ["string", "null"] },
              email_verified: { type: "boolean" },
              is_active:      { type: "boolean" },
              provider:       { type: "string" },
              created_at:     { type: "string" },
              last_login:     { type: ["string", "null"] },
              metadata:       { type: "object" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };

      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const payload = await jwtService.verifyDbUser(auth.slice(7));
      if (!payload) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      if (payload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const [user] = await sql`
        SELECT
          id, email, role, full_name, avatar_url,
          email_verified, is_active, provider,
          created_at, last_login,
          metadata - 'verification_token' - 'verification_exp'
            - 'reset_token' - 'reset_token_exp'
            - 'magic_token' - 'magic_token_exp' AS metadata
        FROM _postgrify_auth.users
        WHERE id = ${payload.sub}
      `;

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send(user);
    })
  );
}