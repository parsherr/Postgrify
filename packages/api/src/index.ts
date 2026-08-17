/**
 * Entry point — creates and starts the Fastify server.
 * All plugins and routes are registered from here.
 */

import Fastify from "fastify";
import { config } from "./config/env.js";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";

const server = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
  // When running behind nginx or another reverse proxy, obtain the real client IP.
  // Without trustProxy: true, req.ip is the proxy's internal IP (172.x.x.x);
  // rate-limiting sees all requests as coming from the same "IP", disabling brute-force protection.
  //
  // Security: specify the Docker internal network range instead of "true".
  // This prevents IP spoofing via a forged X-Forwarded-For header from external clients.
  // Only 172.16.0.0/12 (Docker bridge) and 127.0.0.1 (loopback) are trusted proxies.
  trustProxy: "127.0.0.1, 172.16.0.0/12",
});

async function start() {
  await registerPlugins(server);
  await registerRoutes(server);

  await server.listen({ port: config.PORT, host: "0.0.0.0" });
  server.log.info(`Postgrify API listening on port ${config.PORT}`);
}

// Graceful shutdown: close open pool connections
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