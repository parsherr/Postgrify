/**
 * CORS Plugin — izin verilen origin'leri env'den okur.
 * Üretimde CORS_ORIGINS'i mutlaka kısıtla.
 */

import fp from "fastify-plugin";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";

export const corsPlugin = fp(async (server: FastifyInstance) => {
  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim());

  await server.register(cors, {
    origin: config.NODE_ENV === "development" ? true : origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Database", "X-API-Key"],
    credentials: true,
  });
});