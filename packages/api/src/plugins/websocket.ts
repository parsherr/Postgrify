/**
 * WebSocket plugin — kaldırıldı (terminal özelliği devre dışı).
 * Dosya referans bütünlüğü için korundu.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const websocketPlugin = fp(async (_server: FastifyInstance) => {
  // no-op — terminal/WebSocket desteği kaldırıldı
});