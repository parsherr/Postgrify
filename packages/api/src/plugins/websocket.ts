/**
 * WebSocket plugin — removed (terminal feature disabled).
 * Retained for file reference integrity.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const websocketPlugin = fp(async (_server: FastifyInstance) => {
  // no-op — terminal/WebSocket support has been removed
});