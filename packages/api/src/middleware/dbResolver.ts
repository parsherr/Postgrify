/**
 * DB Resolver Middleware — Determines which database to use for each request.
 *
 * Priority order:
 *   1. URL parameter    →  /db/:database/...
 *   2. HTTP header      →  X-Database: project1
 *   3. Query parameter  →  ?database=project1
 *
 * The resolved value is assigned to `request.dbName`.
 * Returns 400 if the DB name contains invalid characters.
 * Returns 400 if no database can be resolved by any method.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { isValidIdentifier } from "../utils/identifier.js";

export async function dbResolverHook(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Resolve from URL parameter (/db/:database/...)
  const params = req.params as Record<string, string>;
  const fromUrl = params?.database;

  // Resolve from header
  const fromHeader = req.headers["x-database"] as string | undefined;

  // Resolve from query parameter
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