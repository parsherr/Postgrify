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
  // nginx veya diğer reverse proxy arkasındaysa gerçek istemci IP'sini al.
  // trustProxy: true olmadan req.ip proxy'nin iç IP'si (172.x.x.x) olur;
  // rate-limit tüm requestleri aynı "IP"den görür ve brute-force koruması devre dışı kalır.
  //
  // Güvenlik: "true" yerine Docker internal network aralığı belirtilir.
  // Bu sayede dışarıdan gelen X-Forwarded-For header'ı ile IP spoofing önlenir.
  // Yalnızca 172.16.0.0/12 (Docker bridge) ve 127.0.0.1 (loopback) güvenilir proxy sayılır.
  trustProxy: "127.0.0.1, 172.16.0.0/12",
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