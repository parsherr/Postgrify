/**
 * Session Plugin — SessionService'i Fastify'a decorator olarak bağlar.
 * Redis varsa refresh token desteği aktif olur, yoksa graceful degrade.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SessionService } from "../services/sessionService.js";
import { config } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    sessionService: SessionService;
  }
}

export const sessionPlugin = fp(async (server: FastifyInstance) => {
  const sessionService = new SessionService(
    config.REDIS_URL,
    config.REFRESH_TOKEN_EXPIRY
  );

  await sessionService.connect();
  server.decorate("sessionService", sessionService);

  server.addHook("onClose", async () => {
    await sessionService.disconnect();
  });

  server.log.info(
    sessionService.isAvailable
      ? "Sessions: Redis refresh token store ready"
      : "Sessions: Redis unavailable — refresh tokens disabled"
  );
});