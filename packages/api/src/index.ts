/**
 * Entry point — Fastify sunucusunu başlatır.
 * Tüm plugin'ler ve route'lar buradan kayıt edilir.
 */

import Fastify from "fastify";
import { config } from "./config/env.js";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";

const server = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

async function start() {
  await registerPlugins(server);
  await registerRoutes(server);

  await server.listen({ port: config.PORT, host: "0.0.0.0" });
  server.log.info(`Postgrify API listening on port ${config.PORT}`);
}

// Graceful shutdown: açık pool bağlantılarını kapat
const shutdown = async (signal: string) => {
  server.log.info(`${signal} received — shutting down`);
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((err) => {
  console.error(err);
  process.exit(1);
});