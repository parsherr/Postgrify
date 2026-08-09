/**
 * apiKeyGuard — Per-database public auth endpoint'lerini korur.
 *
 * Her managed database'in _postgrify_auth.auth_settings tablosunda
 * bir 'api_key' kaydı bulunur. SDK istemcileri bu key'i
 * X-API-Key header'ı ile gönderir.
 *
 * İstisnalar:
 *   - Geçerli bir Bearer token varsa (admin veya DB token) guard atlanır.
 *     Bu, Postgrify GUI ve backend servislerin key gerektirmeden
 *     auth endpoint'lerine erişmesini sağlar.
 *   - Key henüz provision edilmemişse (schema yok) 503 döner.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { getApiKey } from "../routes/db/auth/provision.js";

export async function apiKeyGuard(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Admin veya DB Bearer token varsa bu guard'ı atla.
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
    // Auth schema henüz provision edilmemiş
    return reply.status(503).send({
      error: "Auth system not yet initialized for this database",
    });
  }

  // timingSafeEqual ile karşılaştır — zamanlama saldırısını engeller.
  // Buffer uzunlukları eşit olmalı; değilse zaten geçersiz.
  const a = Buffer.from(providedKey, "utf8");
  const b = Buffer.from(storedKey,   "utf8");
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return reply.status(401).send({ error: "Invalid API key" });
  }
}