/**
 * Fastify global augmentations — session plugin decorator tipi.
 * auth/cache/pool decorator'ları kendi plugin dosyalarında declare edilir.
 */

import type { SessionService } from "../services/sessionService.js";

declare module "fastify" {
  interface FastifyInstance {
    sessionService: SessionService;
  }
}