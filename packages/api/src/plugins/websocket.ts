/**
 * WebSocket plugin — @fastify/websocket'i kayıt eder.
 * terminal route'larından önce yüklenmeli.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import wsPlugin from "@fastify/websocket";

export const websocketPlugin = fp(async (server: FastifyInstance) => {
  await server.register(wsPlugin);
});