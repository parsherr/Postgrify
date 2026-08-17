/**
 * POST /auth/token — Issues a DB-scoped JWT.
 * Body: { database, secret, scope?, expiresIn? }
 *
 * Rate limit: 20 req/min per IP (brute-force protection).
 */

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { JwtService } from "../../services/jwtService.js";
import { config } from "../../config/env.js";
import { isValidIdentifier } from "../../utils/identifier.js";
import type { TokenScope } from "../../types/auth.js";

function assertExpiresIn(value: string, maxHours: number): void {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid expiresIn format: '${value}'. Use e.g. '1h', '30m'.`);
  const [, num, unit] = match;
  const hours = { s: 1 / 3600, m: 1 / 60, h: 1, d: 24 }[unit as "s" | "m" | "h" | "d"]!;
  if (Number(num) * hours > maxHours) {
    throw new Error(`expiresIn '${value}' exceeds maximum allowed ${maxHours}h`);
  }
}

// A separate secret can be defined per DB.
// Falls back to the global ADMIN_SECRET when absent (convenience for development).
// In production, per-DB secrets should be read from env vars or a secret store.
function getDbSecret(dbName: string): string {
  const envKey = `DB_SECRET_${dbName.toUpperCase()}`;
  return process.env[envKey] ?? config.ADMIN_SECRET;
}

export async function tokenRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.post(
    "/token",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        description: "Issue a DB-scoped JWT",
        tags: ["auth"],
        security: [],
        body: {
          type: "object",
          required: ["database", "secret"],
          properties: {
            database: { type: "string" },
            secret: { type: "string" },
            scope: {
              type: "array",
              items: {
                type: "string",
                enum: ["read", "write", "delete", "schema", "query"],
              },
              default: ["read", "write"],
            },
            expiresIn: { type: "string", default: "24h" },
          },
        },
      },
    },
    async (req, reply) => {
      const { database, secret, scope, expiresIn } = req.body as {
        database: string;
        secret: string;
        scope?: TokenScope[];
        expiresIn?: string;
      };

      if (!isValidIdentifier(database)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      const expected = getDbSecret(database);

      // Timing-safe comparison
      const providedBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expected);
      const valid =
        providedBuf.length === expectedBuf.length &&
        timingSafeEqual(providedBuf, expectedBuf);

      if (!valid) {
        return reply.status(401).send({ error: "Invalid secret" });
      }

      // DB token maximum 168 hours (1 week)
      const expiry = expiresIn ?? "24h";
      try {
        assertExpiresIn(expiry, 168);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }

      const token = await jwtService.signDbToken(
        database,
        scope ?? ["read", "write"],
        expiry
      );

      return reply.send({ token, database, scope: scope ?? ["read", "write"] });
    }
  );
}