/**
 * DB route'larını gruplar. Prefix: /db/:database
 * Her route, önce authenticate → dbResolver → scopeGuard çalıştırır.
 */

import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../middleware/dbResolver.js";
import { createIpAllowlistGuard } from "../../middleware/ipAllowlist.js";
import { tablesRoute } from "./tables.js";
import { rowsRoute } from "./rows.js";
import { queryRoute } from "./query.js";
import { metaRoute } from "./meta.js";
import { backupRoute } from "./backup.js";
import { uploadRoute } from "./upload.js";

export async function dbRoutes(server: FastifyInstance) {
  // Hook sırası: authenticate → dbResolver → ipAllowlistGuard → scopeGuard (route seviyesinde)
  server.addHook("preHandler", server.authenticate);
  server.addHook("preHandler", dbResolverHook);
  // IP kontrol dbResolver'dan sonra — req.dbName gerekli
  server.addHook("preHandler", createIpAllowlistGuard(server));

  await server.register(tablesRoute);
  await server.register(rowsRoute);
  await server.register(metaRoute);
  await server.register(queryRoute);
  await server.register(backupRoute);
  await server.register(uploadRoute);
}