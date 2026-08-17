/**
 * OpenAPI Plugin — generates an OpenAPI 3.1 schema with @fastify/swagger.
 * Scalar UI is served at /api-docs.
 */

import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import scalarFastify from "@scalar/fastify-api-reference";
import { createReadStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FastifyInstance } from "fastify";

// ESM equivalent of __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));
// Two directories up from dist/ after compilation → packages/api/public/
const FAVICON_PATH = join(__dirname, "../../public/favicon.png");

export const openApiPlugin = fp(async (server: FastifyInstance) => {
  // Serve the brand favicon at /favicon.png
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