/**
 * DB Auth route group — prefix: /db/:database/auth
 *
 * Auth endpoint'leri iki katmana ayrılır:
 *   - signup / login / logout / refresh / verify / magic-link / oauth → public, rate-limited
 *   - user CRUD / audit / settings → authenticate + scopeGuard
 *
 * dbResolver: req.dbName'i URL param'dan çözer — her route için gerekli.
 */

import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../../middleware/dbResolver.js";
import { apiKeyGuard } from "../../../middleware/apiKeyGuard.js";
import { createIpAllowlistGuard } from "../../../middleware/ipAllowlist.js";
import { authUsersRoute } from "./users.js";
import { authTokensRoute } from "./tokens.js";
import { authSignupRoute } from "./signup.js";
import { authVerifyRoute } from "./verify.js";
import { authMeRoute } from "./me.js";
import { authPasswordResetRoute } from "./passwordReset.js";
import { authMagicLinkRoute } from "./magicLink.js";
import { authSettingsRoute } from "./settings.js";
import { authAuditRoute } from "./audit.js";
import { authOAuthRoute } from "./oauth.js";
import { authSessionsRoute } from "./sessions.js";
import { authGenerateLinkRoute } from "./generateLink.js";

export async function authDbRoutes(server: FastifyInstance) {
  // Sıra önemli: önce DB adını çöz, sonra API key'i doğrula.
  // apiKeyGuard; Bearer token varsa atlanır — admin/GUI erişimlerine dokunmaz.
  server.addHook("preHandler", dbResolverHook);
  // IP kontrol dbResolver'dan sonra — req.dbName gerekli.
  // login/signup dahil tüm auth endpoint'leri DB'nin IP kısıtlamasına tabi.
  server.addHook("preHandler", createIpAllowlistGuard(server));
  server.addHook("preHandler", apiKeyGuard);

  // Public auth endpoint'leri (rate-limited)
  await server.register(authTokensRoute);        // login / logout / refresh
  await server.register(authSignupRoute);        // signup
  await server.register(authVerifyRoute);        // email verify
  await server.register(authMeRoute);            // GET /me
  await server.register(authPasswordResetRoute); // forgot / reset
  await server.register(authMagicLinkRoute);     // magic link
  await server.register(authOAuthRoute);         // OAuth flow

  // Admin-gated endpoint'leri
  await server.register(authUsersRoute);         // user CRUD + me/password
  await server.register(authGenerateLinkRoute);  // E-39 generate-link
  await server.register(authSettingsRoute);      // per-DB auth settings
  await server.register(authAuditRoute);         // audit log
  await server.register(authSessionsRoute);      // session management
}