/**
 * DB Resolver Middleware — Her request'te hangi veritabanının kullanılacağını belirler.
 *
 * Öncelik sırası:
 *   1. URL parametresi  →  /db/:database/...
 *   2. HTTP header      →  X-Database: project1
 *   3. Query parametresi →  ?database=project1
 *
 * Bulunan değer `request.dbName`'e atanır.
 * DB adı geçersiz karakter içeriyorsa 400 döner.
 * Hiçbir yöntemle DB bulunamazsa 400 döner.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { isValidIdentifier } from "../utils/identifier.js";

export async function dbResolverHook(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // URL parametresinden al (/db/:database/...)
  const params = req.params as Record<string, string>;
  const fromUrl = params?.database;

  // Header'dan al
  const fromHeader = req.headers["x-database"] as string | undefined;

  // Query param'dan al
  const query = req.query as Record<string, string>;
  const fromQuery = query?.database;

  const dbName = fromUrl ?? fromHeader ?? fromQuery;

  if (!dbName) {
    return reply.status(400).send({
      error: "Database not specified",
      message:
        "Provide database via URL (/db/:database), header (X-Database), or query param (?database=)",
    });
  }

  if (!isValidIdentifier(dbName)) {
    return reply.status(400).send({
      error: "Invalid database name",
      message:
        "Database name must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/ and cannot be a reserved word",
    });
  }

  req.dbName = dbName;
}