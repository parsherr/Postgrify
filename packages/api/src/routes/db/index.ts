/**
 * Groups DB routes. Prefix: /db/:database
 *
 * Hook order (per request):
 *   1. authenticateAny — accepts admin, DB-scoped, or DB-user tokens.
 *      - Admin/DB-scoped token → sets req.user.
 *      - DB-user token (iss: "postgrify/db-auth") → sets req.dbUser.
 *      Returns 401 when no token is present or it is invalid.
 *   2. dbResolverHook — resolves req.dbName from URL param / header / query.
 *   3. createIpAllowlistGuard — DB-level IP restriction (requires req.dbName).
 *   4. scopeGuard("...") — route-level scope check based on req.user or req.dbUser.
 *
 * DB-user token scope mapping (enforced by scopeGuard):
 *   admin  role → read / write / delete / schema / query
 *   editor role → read / write / delete / query  (for JOIN/aggregation — Issue #11 fix)
 *   viewer role → read
 */

import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../middleware/dbResolver.js";
import { createIpAllowlistGuard } from "../../middleware/ipAllowlist.js";
import { config } from "../../config/env.js";
import { tablesRoute } from "./tables.js";
import { rowsRoute } from "./rows.js";
import { queryRoute } from "./query.js";
import { metaRoute } from "./meta.js";
import { backupRoute } from "./backup.js";
import { uploadRoute } from "./upload.js";
import { rpcRoute } from "./rpc.js";
import { schemaListsRoute } from "./schemaLists.js";
import { extensionsRoute } from "./extensions.js";

export async function dbRoutes(server: FastifyInstance) {
  // P2: in development mode, log a warning when X-API-Key header arrives on CRUD/query/upload endpoints.
  // Silent in production — existing clients are not affected.
  // X-API-Key is only valid on /db/:db/auth/* endpoints (apiKeyGuard).
  if (config.NODE_ENV === "development") {
    server.addHook("preHandler", async (req) => {
      if (req.headers["x-api-key"]) {
        req.log.warn(
          { path: req.url },
          "X-API-Key header received on a CRUD/query/upload endpoint — " +
          "this header is only accepted on /db/:db/auth/* routes (apiKeyGuard). " +
          "Use Authorization: Bearer <token> for data access."
        );
      }
    });
  }

  // P1: using authenticateAny (previously: authenticate).
  // Difference: DB-user tokens (iss: "postgrify/db-auth") are no longer rejected;
  // req.dbUser is set and the check is delegated to scopeGuard.
  // E-02: OPTIONS (CORS / Allow discovery) — no Bearer; auth is skipped.
  server.addHook("preHandler", async (req, reply) => {
    if (req.method === "OPTIONS") return;
    return server.authenticateAny(req, reply);
  });
  server.addHook("preHandler", dbResolverHook);
  // IP check runs after dbResolver — req.dbName is required
  server.addHook("preHandler", createIpAllowlistGuard(server));

  await server.register(tablesRoute);
  await server.register(rowsRoute);
  await server.register(metaRoute);
  await server.register(queryRoute);
  await server.register(rpcRoute);
  await server.register(backupRoute);
  await server.register(uploadRoute);
  await server.register(schemaListsRoute);
  await server.register(extensionsRoute);
}