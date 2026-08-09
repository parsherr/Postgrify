/**
 * Admin IP Allowlist endpoints.
 *
 * GET    /admin/databases/:db/ip-allowlist  → mevcut config
 * PUT    /admin/databases/:db/ip-allowlist  → config güncelle
 * DELETE /admin/databases/:db/ip-allowlist  → everyone'a sıfırla
 *
 * Tüm endpoint'ler admin route group'unda — authenticateAdmin zaten aktif.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { isValidIdentifier } from "../../utils/identifier.js";
import { parseIpAllowlist } from "../../utils/ipUtils.js";
import { invalidateIpAllowlistCache } from "../../middleware/ipAllowlist.js";

export async function ipAllowlistRoutes(server: FastifyInstance) {
  // ── GET /admin/databases/:db/ip-allowlist ──────────────────────────────────
  server.get(
    "/databases/:db/ip-allowlist",
    {
      schema: {
        description: "Get IP allowlist configuration for a database.",
        tags: ["admin"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["db"],
          properties: {
            db: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["everyone", "same_network", "allowlist"] },
              ips:  { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };
      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }
      const config = await server.settings.getIpAllowlist(db);
      return reply.send(config);
    })
  );

  // ── PUT /admin/databases/:db/ip-allowlist ──────────────────────────────────
  server.put(
    "/databases/:db/ip-allowlist",
    {
      schema: {
        description: "Set IP allowlist configuration for a database.",
        tags: ["admin"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["db"],
          properties: {
            db: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["mode"],
          properties: {
            mode: { type: "string", enum: ["everyone", "same_network", "allowlist"] },
            ips:  { type: "array", items: { type: "string" }, default: [] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok:     { type: "boolean" },
              config: {
                type: "object",
                properties: {
                  mode: { type: "string" },
                  ips:  { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };
      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      let config;
      try {
        config = parseIpAllowlist(req.body);
      } catch (err) {
        return reply.status(400).send({
          error: "Invalid IP allowlist configuration",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      await server.settings.setIpAllowlist(db, config);
      // Middleware cache'ini temizle — yeni ayar hemen devreye girsin
      invalidateIpAllowlistCache(db);

      server.log.info({ db, mode: config.mode, count: config.ips.length }, "IP allowlist updated");

      return reply.send({ ok: true, config });
    })
  );

  // ── DELETE /admin/databases/:db/ip-allowlist ───────────────────────────────
  server.delete(
    "/databases/:db/ip-allowlist",
    {
      schema: {
        description: "Reset IP allowlist to everyone (removes restriction).",
        tags: ["admin"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["db"],
          properties: {
            db: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };
      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      await server.settings.deleteIpAllowlist(db);
      invalidateIpAllowlistCache(db);

      server.log.info({ db }, "IP allowlist reset to everyone");

      return reply.send({ ok: true });
    })
  );
}