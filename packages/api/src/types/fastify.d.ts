/**
 * Fastify tip genişletmeleri — tüm decorator'lar buradan merkezi olarak declare edilir.
 * Bu sayede plugin dosyalarındaki declare module blokları birleşir.
 */

import type { PoolManager } from "../services/poolManager.js";
import type { CacheService } from "../services/cacheService.js";
import type { JwtPayload } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    poolManager: PoolManager;
    cache: CacheService;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: JwtPayload | null;
    dbName: string | null;
  }
}