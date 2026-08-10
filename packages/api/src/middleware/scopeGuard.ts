/**
 * Scope Guard Middleware — JWT token'ın istenen scope'a sahip olup olmadığını kontrol eder.
 * Admin token tüm scope'ları otomatik geçer.
 *
 * DB-user token'ları (iss: "postgrify/db-auth") da desteklenir:
 *   - "admin" rolü → schema dahil tüm scope'lar
 *   - "editor" rolü → read, write, delete
 *   - "viewer" rolü → yalnızca read
 *
 * Kullanım:
 *   preHandler: [server.authenticate, scopeGuard("write")]
 *   preHandler: [server.authenticateAny, scopeGuard("write")]  ← DB-user token için
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { TokenScope } from "../types/auth.js";

/**
 * Per-DB kullanıcı rolünü izin verilen scope listesine eşler.
 *
 * Rol açıklamaları:
 *   admin  — tam erişim (DDL dahil)
 *   editor — veri okuma/yazma/silme + ham SELECT sorgusu (JOIN, aggregation, vb.)
 *   viewer — sadece okuma (SELECT, basit filtreler)
 *
 * NOT: "query" scope editor'a da verildi (SORUN #11 düzeltmesi).
 * Gerekçe: JOIN içeren sorguları /query endpoint'i üzerinden çalıştırmak zorunlu
 * (rows endpoint JOIN desteklemiyor). SELECT-only /query için "query" scope'u
 * sadece admin'de tutmak, editor kullanıcıların timeline gibi temel özellikleri
 * kullanamamasına neden oluyordu. Admin token ile "schema" ve tam DDL ayrımı korunuyor.
 */
const DB_USER_ROLE_SCOPES: Record<string, TokenScope[]> = {
  admin:  ["read", "write", "delete", "schema", "query"],
  editor: ["read", "write", "delete", "query"],
  viewer: ["read"],
};

export function scopeGuard(required: TokenScope) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // ── DB-user token path ─────────────────────────────────────────────────
    // authenticateAny ile gelmiş per-DB kullanıcı token'ı
    if (req.dbUser) {
      const dbUser = req.dbUser;

      // Token hangi DB için verilmiş?
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

    // Admin token her scope'u geçer
    if (user.role === "admin") return;

    // DB token kendi DB'sine erişebilir
    if (user.sub !== req.dbName) {
      return reply.status(403).send({
        error: "Access denied",
        message: `Token is issued for database '${user.sub}', not '${req.dbName}'`,
      });
    }

    // İstenen scope'u kontrol et
    if (!user.scope?.includes(required)) {
      return reply.status(403).send({
        error: "Insufficient permissions",
        message: `This action requires '${required}' scope`,
      });
    }
  };
}