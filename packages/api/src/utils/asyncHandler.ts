/**
 * Async hata yakalama yardımcısı.
 * Route handler'larında try/catch yazmak yerine bu wrapper kullanılır.
 * Bilinmeyen hatalar 500 olarak döner; Error instance'ları mesajlarıyla birlikte.
 */

import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from "fastify";

type AsyncHandler = (
  req: FastifyRequest,
  reply: FastifyReply
) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler): RouteHandlerMethod {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(req, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      const status = getStatusFromError(err);
      return reply.status(status).send({ error: message });
    }
  };
}

function getStatusFromError(err: unknown): number {
  if (err instanceof Error) {
    const msg = err.message;
    // Client SQL / FTS mistakes first — PG says "configuration X does not exist"
    // which must not become a generic 404 (E-11 live harden).
    if (
      /invalid input syntax|syntax error in tsquery|text search configuration|cannot cast|could not convert/i.test(
        msg
      )
    ) {
      return 400;
    }
    if (msg.includes("does not exist")) return 404;
    if (msg.includes("Invalid") || msg.includes("Unknown")) return 400;
    if (msg.includes("permission denied")) return 403;
    if (msg.includes("duplicate key")) return 409;
  }
  return 500;
}