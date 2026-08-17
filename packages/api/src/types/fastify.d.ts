/**
 * Fastify global augmentations — session plugin decorator tipi.
 * auth/cache/pool decorators are declared in their respective plugin files.
 */

import type { SessionService } from "../services/sessionService.js";

declare module "fastify" {
  interface FastifyInstance {
    sessionService: SessionService;
  }
}