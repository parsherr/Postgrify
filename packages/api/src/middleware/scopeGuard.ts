/**
 * Scope Guard Middleware — JWT token'ın istenen scope'a sahip olup olmadığını kontrol eder.
 * Admin token tüm scope'ları otomatik geçer.
 *
 * Kullanım:
 *   preHandler: [server.authenticate, scopeGuard("write")]
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { TokenScope } from "../types/auth.js";

export function scopeGuard(required: TokenScope) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
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