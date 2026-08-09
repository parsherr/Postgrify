/**
 * Auth Plugin — JWT doğrulama ve request'e kullanıcı bilgisi ekleme.
 * `server.authenticate` ve `server.authenticateAdmin` decorator'larını sağlar.
 * Her route, bu decorator'ları preHandler olarak kullanabilir.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { JwtService, jtiBlacklist } from "../services/jwtService.js";
import { config } from "../config/env.js";
import type { JwtPayload } from "../types/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    jwtService: JwtService;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtPayload | null;
    dbName: string | null;
  }
}

export const authPlugin = fp(async (server: FastifyInstance) => {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  // JwtService'i tüm route'lardan erişilebilir kıl (DRY: inline new JwtService() gerekmez)
  server.decorate("jwtService", jwtService);

  // JTI blacklist'e Redis client bağla (Redis varsa distributed revocation).
  // Redis yoksa in-memory fallback — process restart'ta sıfırlanır.
  server.addHook("onReady", async () => {
    const redisClient = server.cache?.redisClient;
    if (redisClient) {
      jtiBlacklist.setRedis(redisClient as Parameters<typeof jtiBlacklist.setRedis>[0]);
      server.log.info("JTI blacklist connected to Redis");
    } else {
      server.log.warn("JTI blacklist using in-memory store (no Redis) — token revocation resets on restart");
    }
  });

  // request.user ve request.dbName'i her request'te null ile başlat
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // DB token veya admin token ile erişilebilen route'lar için
  server.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(req);
      if (!token) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const payload = await jwtService.verifyAdminOrDb(token);
      if (!payload) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      req.user = payload;
    }
  );

  // Yalnızca admin token ile erişilebilen route'lar için
  server.decorate(
    "authenticateAdmin",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(req);
      if (!token) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const payload = await jwtService.verifyAdminOrDb(token);
      if (!payload || payload.role !== "admin") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      req.user = payload;
    }
  );
});

function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}