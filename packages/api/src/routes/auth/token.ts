/**
 * POST /auth/token — DB bazlı JWT üretir.
 * Body: { database, secret, scope?, expiresIn? }
 *
 * Rate limit: IP başına 20 req/dk (brute-force koruması).
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

// Her DB için ayrı secret tanımlanabilir.
// Yoksa global ADMIN_SECRET'a fallback yapar (geliştirme kolaylığı için).
// Üretimde DB bazlı secret'lar env veya secret store'dan okunmalıdır.
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

      // Timing-safe karşılaştırma
      const providedBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expected);
      const valid =
        providedBuf.length === expectedBuf.length &&
        timingSafeEqual(providedBuf, expectedBuf);

      if (!valid) {
        return reply.status(401).send({ error: "Invalid secret" });
      }

      // DB token max 168 saat (1 hafta)
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