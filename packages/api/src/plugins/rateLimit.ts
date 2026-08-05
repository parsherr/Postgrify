/**
 * Rate Limit Plugin — @fastify/rate-limit tabanlı.
 * Global IP limiti burada uygulanır.
 * Route bazlı limitler (DB token, admin) ilgili route'larda override edilir.
 */

import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";

export const rateLimitPlugin = fp(async (server: FastifyInstance) => {
  await server.register(rateLimit, {
    max: config.RATE_LIMIT_GLOBAL,
    timeWindow: "1 minute",
    // Not: @fastify/rate-limit ioredis bekler; node-redis v4 uyumsuz.
    // Dağıtık deployment gerekirse ioredis eklenip burası güncellenmeli.
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