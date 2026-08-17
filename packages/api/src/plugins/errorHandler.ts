/**
 * Global Error Handler — prevents stack trace leakage in production.
 *
 * Fastify serializes errors automatically by default.
 * However, in unhandled exceptions, stack traces and internal error messages
 * can leak to the client. This plugin:
 *
 *   - Logs every error with a unique errorId (traceable for debugging)
 *   - Hides stack traces and internal error details in production
 *   - Converts Fastify validation errors (400) to a clean format
 *   - Forwards known HTTP error codes (4xx, 5xx) with the correct status
 *
 * Security note: error messages containing file paths, SQL queries, or
 * internal service names can guide an attacker.
 * This handler suppresses them in production.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import crypto from "node:crypto";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export const errorHandlerPlugin = fp(async (server: FastifyInstance) => {
  server.setErrorHandler((error: FastifyError, _req, reply) => {
    // Unique ID per error — logged for support and debugging
    const errorId = crypto.randomUUID();

    // All errors are logged server-side with full detail
    server.log.error(
      { err: error, errorId },
      `[${errorId}] ${error.message}`
    );

    const statusCode = error.statusCode ?? 500;

    // Fastify schema validation error (400)
    if (error.validation) {
      return reply.status(400).send({
        error: "Validation Error",
        message: error.message,
        // Show validation details in all environments — this is public schema information
        details: error.validation,
      });
    }

    // 4xx: client errors — forward the message (Fastify BusinessErrors)
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: error.message,
        errorId,
      });
    }

    // 5xx: server errors
    if (isProduction()) {
      // Hide internal error details in production
      return reply.status(statusCode).send({
        error: "Internal Server Error",
        message: "An unexpected error occurred. Please contact support.",
        errorId,
      });
    }

    // Development: full detail
    return reply.status(statusCode).send({
      error: error.message,
      stack: error.stack,
      errorId,
    });
  });

  // Catch unhandled rejections — these do not reach Fastify's errorHandler
  // and can crash the process. Log them and continue gracefully.
  server.addHook("onError", async (_req, _reply, error) => {
    const errorId = crypto.randomUUID();
    server.log.error({ err: error, errorId }, `[onError hook] ${error.message}`);
  });
});