/**
 * Rate Limit Plugin — @fastify/rate-limit tabanlı.
 *
 * Redis varsa (REDIS_URL) ioredis backend kullanılır — distributed deployment'ta
 * doğru çalışması için zorunludur; aksi takdirde her container bağımsız sayar.
 * Redis yoksa in-memory sayaç kullanılır (tek container geliştirme ortamı).
 *
 * Global IP limiti burada uygulanır.
 * Route bazlı limitler (DB token, admin login) ilgili route'larda override edilir.
 */

import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";

export const rateLimitPlugin = fp(async (server: FastifyInstance) => {
  // ioredis backend — Redis URL varsa distributed rate-limit etkin
  let redisClient: import("ioredis").Redis | undefined;

  if (config.REDIS_URL) {
    try {
      const { Redis } = await import("ioredis");
      redisClient = new Redis(config.REDIS_URL, {
        // Bağlantı koparsa agresif retry yapma — rate-limit için non-critical
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: false,
        connectTimeout: 5_000,
      });

      redisClient.on("error", (err: Error) => {
        server.log.warn(`[rateLimit] Redis error (falling back to in-memory): ${err.message}`);
      });

      server.log.info("[rateLimit] Using Redis-backed rate limiting (distributed)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      server.log.warn(`[rateLimit] Failed to create Redis client, using in-memory: ${msg}`);
      redisClient = undefined;
    }
  } else {
    server.log.warn(
      "[rateLimit] REDIS_URL not set — using in-memory rate limiting. " +
      "Multi-instance deployments will NOT share rate-limit state."
    );
  }

  await server.register(rateLimit, {
    max: config.RATE_LIMIT_GLOBAL,
    timeWindow: "1 minute",
    // ioredis client varsa Redis store kullan
    ...(redisClient ? { redis: redisClient } : {}),
    errorResponseBuilder: (_req, context) => {
      const retryAfter = Math.ceil(context.ttl / 1000);
      return {
        statusCode: 429,
        error: "Too many requests",
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        retryAfter,
      };
    },
  });
});