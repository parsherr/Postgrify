/**
 * Scope Guard Middleware — checks whether the JWT token has the required scope.
 * Admin tokens always pass all scope checks automatically.
 *
 * DB-user tokens (iss: "postgrify/db-auth") are also supported:
 *   - "admin" role  → all scopes including schema
 *   - "editor" role → read, write, delete
 *   - "viewer" role → read only
 *
 * Usage:
 *   preHandler: [server.authenticate, scopeGuard("write")]
 *   preHandler: [server.authenticateAny, scopeGuard("write")]  ← for DB-user tokens
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { TokenScope } from "../types/auth.js";

/**
 * Maps each per-DB user role to its list of allowed scopes.
 *
 * Role descriptions:
 *   admin  — full access (including DDL)
 *   editor — read/write/delete data + raw SELECT queries (JOINs, aggregations, etc.)
 *   viewer — read only (SELECT, simple filters)
 *
 * NOTE: the "query" scope was also granted to editor (fix for ISSUE #11).
 * Rationale: queries involving JOINs must run through the /query endpoint
 * (the rows endpoint does not support JOINs). Keeping "query" scope admin-only
 * for SELECT-only /query was preventing editor users from using basic features
 * such as timeline views. The "schema" scope and full DDL separation via admin
 * tokens is preserved.
 */
const DB_USER_ROLE_SCOPES: Record<string, TokenScope[]> = {
  admin:  ["read", "write", "delete", "schema", "query"],
  editor: ["read", "write", "delete", "query"],
  viewer: ["read"],
};

export function scopeGuard(required: TokenScope) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // ── DB-user token path ─────────────────────────────────────────────────
    // Per-DB user token arriving via authenticateAny
    if (req.dbUser) {
      const dbUser = req.dbUser;

      // Which database was this token issued for?
      if (dbUser.db !== req.dbName) {
        return reply.status(403).send({
          error: "Access denied",
          message: `Token is issued for database '${dbUser.db}', not '${req.dbName}'`,
        });
      }

      const allowedScopes = DB_USER_ROLE_SCOPES[dbUser.role] ?? [];
      if (!allowedScopes.includes(required)) {
        return reply.status(403).send({
          error: "Insufficient permissions",
          message: `This action requires '${required}' scope. Your role '${dbUser.role}' has: ${allowedScopes.join(", ")}`,
        });
      }
      return;
    }

    // ── Admin / scoped-DB token path ───────────────────────────────────────
    const user = req.user;

    if (!user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    // Admin token passes all scopes
    if (user.role === "admin") return;

    // DB token may only access its own database
    if (user.sub !== req.dbName) {
      return reply.status(403).send({
        error: "Access denied",
        message: `Token is issued for database '${user.sub}', not '${req.dbName}'`,
      });
    }

    // Check for the required scope
    if (!user.scope?.includes(required)) {
      return reply.status(403).send({
        error: "Insufficient permissions",
        message: `This action requires '${required}' scope`,
      });
    }
  };
}