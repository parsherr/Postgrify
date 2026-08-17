/**
 * CORS Plugin — reads allowed origins from the environment.
 * Always restrict CORS_ORIGINS in production.
 */

import fp from "fastify-plugin";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";

export const corsPlugin = fp(async (server: FastifyInstance) => {
  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim());

  await server.register(cors, {
    origin: config.NODE_ENV === "development" ? true : origins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Prefer",
      "X-Database",
      "X-API-Key",
      "Range",
      "Range-Unit",
    ],
    credentials: true,
    // E-02: let OPTIONS reach the table handler (Allow header), not only CORS 204.
    strictPreflight: false,
    preflightContinue: true,
  });
});