/**
 * apiKeyGuard — Guards public per-database auth endpoints.
 *
 * Each managed database stores an 'api_key' record in its
 * _postgrify_auth.auth_settings table. SDK clients send this key
 * via the X-API-Key header.
 *
 * Exceptions:
 *   - If a valid Bearer token is present (admin or DB token) the guard is skipped.
 *     This allows the Postgrify GUI and backend services to reach auth endpoints
 *     without an API key.
 *   - If the key has not yet been provisioned (no schema) a 503 is returned.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { getApiKey } from "../routes/db/auth/provision.js";

export async function apiKeyGuard(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip this guard if an admin or DB Bearer token is present.
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return;
  }

  const dbName = req.dbName;
  if (!dbName) {
    return reply.status(400).send({ error: "Database name could not be resolved" });
  }

  const providedKey = req.headers["x-api-key"] as string | undefined;
  if (!providedKey) {
    return reply.status(401).send({ error: "Missing X-API-Key header" });
  }

  const server = req.server as FastifyInstance;
  const sql = server.poolManager.getPool(dbName);

  const storedKey = await getApiKey(sql);
  if (!storedKey) {
    // Auth schema has not been provisioned yet
    return reply.status(503).send({
      error: "Auth system not yet initialized for this database",
    });
  }

  // Compare with timingSafeEqual — prevents timing attacks.
  // Buffers must be the same length; if not, the key is already invalid.
  const a = Buffer.from(providedKey, "utf8");
  const b = Buffer.from(storedKey,   "utf8");
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return reply.status(401).send({ error: "Invalid API key" });
  }
}