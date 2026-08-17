/**
 * Rate Limit Plugin — based on @fastify/rate-limit.
 *
 * When Redis is available (REDIS_URL), the ioredis backend is used — required for
 * correct behaviour in distributed deployments; without it each container counts
 * independently. When Redis is absent, an in-memory counter is used (single-container
 * development environments).
 *
 * The global IP limit is applied here.
 * Per-route limits (DB token, admin login) are overridden in their respective routes.
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
        // Do not retry aggressively on connection loss — rate-limiting is non-critical
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
    // Use Redis store if an ioredis client is available
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