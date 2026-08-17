/**
 * DB Auth route group — prefix: /db/:database/auth
 *
 * Auth endpoints are split into two layers:
 *   - signup / login / logout / refresh / verify / magic-link / oauth → public, rate-limited
 *   - user CRUD / audit / settings → authenticate + scopeGuard
 *
 * dbResolver: resolves req.dbName from the URL param — required for every route.
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
import { authAdminUsersRoute } from "./adminUsers.js";
import { authGenerateLinkRoute } from "./generateLink.js";
import { authBanRoute } from "./ban.js";

export async function authDbRoutes(server: FastifyInstance) {
  // Order matters: resolve DB name first, then validate the API key.
  // apiKeyGuard is skipped when a Bearer token is present — does not affect admin/GUI access.
  server.addHook("preHandler", dbResolverHook);
  // IP check runs after dbResolver — req.dbName is required.
  // All auth endpoints, including login/signup, are subject to the DB's IP restriction.
  server.addHook("preHandler", createIpAllowlistGuard(server));
  server.addHook("preHandler", apiKeyGuard);

  // Public auth endpoints (rate-limited)
  await server.register(authTokensRoute);        // login / logout / refresh
  await server.register(authSignupRoute);        // signup
  await server.register(authVerifyRoute);        // email verify
  await server.register(authMeRoute);            // GET /me
  await server.register(authPasswordResetRoute); // forgot / reset
  await server.register(authMagicLinkRoute);     // magic link
  await server.register(authOAuthRoute);         // OAuth flow

  // Admin-gated endpoints
  await server.register(authUsersRoute);         // user CRUD + me/password
  await server.register(authSettingsRoute);      // per-DB auth settings
  await server.register(authAuditRoute);         // audit log
  await server.register(authSessionsRoute);      // session management
  await server.register(authAdminUsersRoute);    // GET /admin/users/:id (E-38)
  await server.register(authGenerateLinkRoute);  // POST /admin/generate-link (E-39)
  await server.register(authBanRoute);           // POST /admin/users/:id/ban (E-41)
}