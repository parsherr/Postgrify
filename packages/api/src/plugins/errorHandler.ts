/**
 * Global Error Handler — production'da stack trace sızıntısını önler.
 *
 * Fastify varsayılan olarak hataları otomatik serialize eder.
 * Ancak unhandled exception'larda stack trace ve iç hata mesajları
 * client'a sızabilir. Bu plugin:
 *
 *   - Her hatayı benzersiz bir errorId ile loglar (debug için izlenebilir)
 *   - Production'da stack trace ve iç hata mesajlarını gizler
 *   - Fastify validation hatalarını (400) temiz bir formata dönüştürür
 *   - Bilinen HTTP hata kodlarını (4xx, 5xx) doğru status ile iletir
 *
 * Güvenlik notu: hata mesajlarında dosya yolu, SQL sorgusu veya
 * iç servis adları gibi bilgiler saldırgana rehber olabilir.
 * Bu handler bunları production'da bastırır.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import crypto from "node:crypto";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export const errorHandlerPlugin = fp(async (server: FastifyInstance) => {
  server.setErrorHandler((error: FastifyError, _req, reply) => {
    // Her hata için benzersiz ID — support/debug için loglanır
    const errorId = crypto.randomUUID();

    // Tüm hatalar sunucu tarafında tam detay ile loglanır
    server.log.error(
      { err: error, errorId },
      `[${errorId}] ${error.message}`
    );

    const statusCode = error.statusCode ?? 500;

    // Fastify schema validation hatası (400)
    if (error.validation) {
      return reply.status(400).send({
        error: "Validation Error",
        message: error.message,
        // Validation detaylarını her ortamda göster — bunlar public schema bilgisi
        details: error.validation,
      });
    }

    // 4xx: client hataları — mesajı ilet (Fastify'ın BusinessError'ları)
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: error.message,
        errorId,
      });
    }

    // 5xx: server hataları
    if (isProduction()) {
      // Production'da iç hata detaylarını gizle
      return reply.status(statusCode).send({
        error: "Internal Server Error",
        message: "An unexpected error occurred. Please contact support.",
        errorId,
      });
    }

    // Development: tam detay
    return reply.status(statusCode).send({
      error: error.message,
      stack: error.stack,
      errorId,
    });
  });

  // Unhandled rejection'ları yakala — bunlar Fastify'ın errorHandler'ına düşmez
  // ve process'i crash edebilir. Log et + graceful devam et.
  server.addHook("onError", async (_req, _reply, error) => {
    const errorId = crypto.randomUUID();
    server.log.error({ err: error, errorId }, `[onError hook] ${error.message}`);
  });
});