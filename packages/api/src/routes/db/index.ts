/**
 * DB route'larını gruplar. Prefix: /db/:database
 *
 * Hook sırası (her istek için):
 *   1. authenticateAny — admin, DB-scoped veya DB-user token'larını kabul eder.
 *      - Admin/DB-scoped token → req.user set edilir.
 *      - DB-user token (iss: "postgrify/db-auth") → req.dbUser set edilir.
 *      Token yoksa veya geçersizse 401 döner.
 *   2. dbResolverHook — req.dbName'i URL param / header / query'den çözer.
 *   3. createIpAllowlistGuard — DB bazlı IP kısıtlaması (req.dbName gerekli).
 *   4. scopeGuard("...") — route seviyesinde, req.user veya req.dbUser'a göre scope kontrolü.
 *
 * DB-user token scope mapping (scopeGuard tarafından uygulanır):
 *   admin  role → read / write / delete / schema / query
 *   editor role → read / write / delete / query  (JOIN/aggregation için — SORUN #11 düzeltmesi)
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
  // P2: geliştirme modunda X-API-Key header'ı CRUD/query/upload endpoint'lerine
  // gelince uyarı log'la. Production'da sessiz — mevcut istemciler etkilenmez.
  // X-API-Key yalnızca /db/:db/auth/* endpoint'lerinde geçerlidir (apiKeyGuard).
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

  // P1: authenticateAny kullanılıyor (eskiden: authenticate).
  // Fark: DB-user token'ları (iss: "postgrify/db-auth") artık reddedilmiyor;
  // req.dbUser set edilip scopeGuard'a bırakılıyor.
  // E-02: OPTIONS (CORS / Allow discovery) — Bearer yok; auth atlanır.
  server.addHook("preHandler", async (req, reply) => {
    if (req.method === "OPTIONS") return;
    return server.authenticateAny(req, reply);
  });
  server.addHook("preHandler", dbResolverHook);
  // IP kontrol dbResolver'dan sonra — req.dbName gerekli
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