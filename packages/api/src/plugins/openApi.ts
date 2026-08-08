/**
 * OpenAPI Plugin — @fastify/swagger ile OpenAPI 3.1 şeması üretir.
 * Scalar UI /api-docs üzerinden serve edilir.
 */

import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import scalarFastify from "@scalar/fastify-api-reference";
import { createReadStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FastifyInstance } from "fastify";

// ESM'de __dirname karşılığı
const __dirname = dirname(fileURLToPath(import.meta.url));
// Derleme sonrası dist/ altından iki üst dizin → packages/api/public/
const FAVICON_PATH = join(__dirname, "../../public/favicon.png");

export const openApiPlugin = fp(async (server: FastifyInstance) => {
  // Brand favicon'u /favicon.png üzerinden serve et
  server.get("/favicon.png", async (_req, reply) => {
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(FAVICON_PATH));
  });

  await server.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Postgrify API",
        description:
          "Multi-database PostgreSQL REST gateway. Access any database via a single HTTP API.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await server.register(scalarFastify, {
    routePrefix: "/api-docs",
    configuration: {
      title: "Postgrify API Docs",
      favicon: "/favicon.png",
    },
  });
});