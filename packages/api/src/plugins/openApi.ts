/**
 * OpenAPI Plugin — @fastify/swagger ile OpenAPI 3.1 şeması üretir.
 * Scalar UI /api-docs üzerinden serve edilir.
 */

import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import scalarFastify from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";

export const openApiPlugin = fp(async (server: FastifyInstance) => {
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
      title: "Postgrify API Reference",
    },
  });
});