/**
 * Auth Plugin — JWT doğrulama ve request'e kullanıcı bilgisi ekleme.
 * `server.authenticate` ve `server.authenticateAdmin` decorator'larını sağlar.
 * Her route, bu decorator'ları preHandler olarak kullanabilir.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { JwtService, jtiBlacklist } from "../services/jwtService.js";
import { config } from "../config/env.js";
import type { JwtPayload, DbUserJwtPayload } from "../types/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    jwtService: JwtService;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    /**
     * Admin, scoped-DB veya per-DB-user token kabul eden authenticator.
     * CRUD endpoint'lerinde DB-user token'ların da erişebilmesi için kullanılır.
     * DB-user token kabul edildiğinde req.dbUserPayload set edilir.
     */
    authenticateAny: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtPayload | null;
    dbName: string | null;
    /** Per-DB kullanıcı token payload'ı — yalnızca DB-user token ile doldurilur. */
    dbUser: DbUserJwtPayload | null;
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

  // request.user, request.dbName ve request.dbUser'ı her request'te null ile başlat
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

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
// Admin, scoped-DB veya per-DB-user token kabul eden authenticator.
  // DB-user token'lar "postgrify/db-auth" issuer'ı ile gelir.
  // Kabul edildiğinde req.dbUser doldurulur; req.user null kalır.
  // Bu sayede scopeGuard, DB-user token'ları admin bypass'ı olmadan kabul eder —
  // ama scopeGuard'ın DB-user farkındalığı gerekir (scopeGuard.ts'e bakın).
  server.decorate(
    "authenticateAny",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(req);
      if (!token) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      // Önce admin/DB token dene
      const adminOrDb = await jwtService.verifyAdminOrDb(token);
      if (adminOrDb) {
        req.user = adminOrDb;
        return;
      }

      // DB-user token dene
      const dbUser = await jwtService.verifyDbUser(token);
      if (dbUser) {
        req.dbUser = dbUser;
        return;
      }

      return reply.status(401).send({ error: "Invalid or expired token" });
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