/**
 * DB route'larını gruplar. Prefix: /db/:database
 * Her route, önce authenticate → dbResolver → scopeGuard çalıştırır.
 */

import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../middleware/dbResolver.js";
import { tablesRoute } from "./tables.js";
import { rowsRoute } from "./rows.js";
import { queryRoute } from "./query.js";
import { metaRoute } from "./meta.js";
import { backupRoute } from "./backup.js";

export async function dbRoutes(server: FastifyInstance) {
  // Tüm /db route'larında auth + DB çözümleme zorunlu
  server.addHook("preHandler", server.authenticate);
  server.addHook("preHandler", dbResolverHook);

  await server.register(tablesRoute);
  await server.register(rowsRoute);
  await server.register(metaRoute);
  await server.register(queryRoute);
  await server.register(backupRoute);
}