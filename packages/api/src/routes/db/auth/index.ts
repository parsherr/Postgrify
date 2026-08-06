/**
 * DB Auth route group — prefix: /db/:database/auth
 *
 * Auth endpoint'leri iki katmana ayrılır:
 *   - login / logout / refresh → public, rate-limited (authenticate yok)
 *   - user CRUD → authenticate + scopeGuard (her route kendi preHandler'ını yönetir)
 *
 * dbResolver: req.dbName'i URL param'dan çözer — her route için gerekli.
 */

import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../../middleware/dbResolver.js";
import { authUsersRoute } from "./users.js";
import { authTokensRoute } from "./tokens.js";

export async function authDbRoutes(server: FastifyInstance) {
  // Tüm auth route'larında DB adını URL'den çöz
  server.addHook("preHandler", dbResolverHook);

  await server.register(authUsersRoute);
  await server.register(authTokensRoute);
}