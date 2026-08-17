/**
 * Auth Plugin — JWT validation and attaching user info to requests.
 * Provides the `server.authenticate` and `server.authenticateAdmin` decorators.
 * Any route can use these decorators as preHandlers.
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
     * Authenticator that accepts admin, scoped-DB, or per-DB-user tokens.
     * Used so that DB-user tokens can also access CRUD endpoints.
     * When a DB-user token is accepted, req.dbUserPayload is set.
     */
    authenticateAny: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtPayload | null;
    dbName: string | null;
    /** Per-DB user token payload — populated only when a DB-user token is used. */
    dbUser: DbUserJwtPayload | null;
  }
}

export const authPlugin = fp(async (server: FastifyInstance) => {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  // Make JwtService accessible from all routes (DRY: no need for inline new JwtService())
  server.decorate("jwtService", jwtService);

  // Connect Redis client to the JTI blacklist (enables distributed revocation when Redis is available).
  // Falls back to in-memory when Redis is absent — resets on process restart.
  server.addHook("onReady", async () => {
    const redisClient = server.cache?.redisClient;
    if (redisClient) {
      jtiBlacklist.setRedis(redisClient as Parameters<typeof jtiBlacklist.setRedis>[0]);
      server.log.info("JTI blacklist connected to Redis");
    } else {
      server.log.warn("JTI blacklist using in-memory store (no Redis) — token revocation resets on restart");
    }
  });

  // Initialise request.user, request.dbName, and request.dbUser to null on every request
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

  // For routes accessible with either a DB token or an admin token
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

  // For routes accessible with admin tokens only
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
// Authenticator that accepts admin, scoped-DB, or per-DB-user tokens.
  // DB-user tokens arrive with issuer "postgrify/db-auth".
  // When accepted, req.dbUser is populated; req.user remains null.
  // This allows scopeGuard to accept DB-user tokens without an admin bypass —
  // but scopeGuard must be DB-user-aware (see scopeGuard.ts).
  server.decorate(
    "authenticateAny",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(req);
      if (!token) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      // Try admin/DB token first
      const adminOrDb = await jwtService.verifyAdminOrDb(token);
      if (adminOrDb) {
        req.user = adminOrDb;
        return;
      }

      // Try DB-user token
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