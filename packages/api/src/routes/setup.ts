/**
 * Setup endpoints — ilk kurulum sihirbazı.
 *
 * GET  /setup/status  → { configured: boolean }
 * POST /setup         → admin kimlik bilgileri + PG bağlantısı kaydeder
 *
 * POST /setup yalnızca configured=false iken çalışır; sonra 403 döner.
 * Her iki endpoint de auth gerektirmez.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../services/passwordService.js";
import { config } from "../config/env.js";

/** .env dosyasının konumu — docker içinde /app/packages/.env, local'de packages/.env */
function resolveEnvPath(): string {
  // API çalışma dizininden üst klasöre çık (packages/api → packages)
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", "packages", ".env"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Bulunamazsa packages/ yanına oluştur
  return path.resolve(process.cwd(), "..", ".env");
}

/** .env dosyasını satır satır parse eder → Map<key, raw-line-index> */
function parseEnvFile(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    map.set(key, i);
  }
  return map;
}

/** .env içindeki key'i günceller; yoksa en sona ekler. */
function writeEnvKey(
  lines: string[],
  indexMap: Map<string, number>,
  key: string,
  value: string
): void {
  // Değerde boşluk veya özel karakter varsa tırnak içine al
  const needsQuotes = /[\s#"'\\]/.test(value);
  const formatted = needsQuotes ? `${key}="${value.replace(/"/g, '\\"')}"` : `${key}=${value}`;

  if (indexMap.has(key)) {
    lines[indexMap.get(key)!] = formatted;
  } else {
    lines.push(formatted);
    indexMap.set(key, lines.length - 1);
  }
}

/** Konfigürasyon tamamlanmış mı? */
function isConfigured(): boolean {
  return Boolean(config.ADMIN_EMAIL && config.ADMIN_PASSWORD_HASH);
}

export async function setupRoutes(server: FastifyInstance) {
  // ──────────────────────────────────────────────
  // GET /setup/status
  // ──────────────────────────────────────────────
  server.get(
    "/status",
    {
      schema: {
        description: "Returns whether initial setup has been completed.",
        tags: ["setup"],
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              configured: { type: "boolean" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({ configured: isConfigured() });
    }
  );

  // ──────────────────────────────────────────────
  // POST /setup
  // ──────────────────────────────────────────────
  server.post(
    "/",
    {
      schema: {
        description: "Initial setup: save admin credentials and PostgreSQL connection to .env.",
        tags: ["setup"],
        security: [],
        body: {
          type: "object",
          required: ["adminEmail", "adminPassword", "pgHost", "pgPort", "pgUser", "pgPassword"],
          properties: {
            adminEmail:    { type: "string", format: "email" },
            adminPassword: { type: "string", minLength: 8 },
            pgHost:        { type: "string", minLength: 1 },
            pgPort:        { type: "number", minimum: 1, maximum: 65535 },
            pgUser:        { type: "string", minLength: 1 },
            pgPassword:    { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              message: { type: "string" },
            },
          },
          403: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      // Zaten kurulumlu → kilitli
      if (isConfigured()) {
        return reply.status(403).send({ error: "Setup already completed" });
      }

      const { adminEmail, adminPassword, pgHost, pgPort, pgUser, pgPassword } =
        req.body as {
          adminEmail: string;
          adminPassword: string;
          pgHost: string;
          pgPort: number;
          pgUser: string;
          pgPassword: string;
        };

      // Şifreyi hash'le
      const passwordHash = await hashPassword(adminPassword);

      // JWT_SECRET / ADMIN_SECRET üret (yoksa)
      const jwtSecret =
        config.JWT_SECRET.length >= 32
          ? config.JWT_SECRET
          : crypto.randomBytes(32).toString("hex");

      const adminSecret =
        config.ADMIN_SECRET.length >= 16
          ? config.ADMIN_SECRET
          : crypto.randomBytes(16).toString("hex");

      // .env dosyasını oku (yoksa boş)
      const envPath = resolveEnvPath();
      let rawContent = "";
      try {
        rawContent = fs.readFileSync(envPath, "utf8");
      } catch {
        rawContent = "";
      }

      const lines = rawContent.split("\n");
      const indexMap = parseEnvFile(rawContent);

      // Yazılacak key'ler
      writeEnvKey(lines, indexMap, "PG_HOST",             pgHost);
      writeEnvKey(lines, indexMap, "PG_PORT",             String(pgPort));
      writeEnvKey(lines, indexMap, "PG_USER",             pgUser);
      writeEnvKey(lines, indexMap, "PG_PASSWORD",         pgPassword);
      writeEnvKey(lines, indexMap, "ADMIN_EMAIL",         adminEmail);
      writeEnvKey(lines, indexMap, "ADMIN_PASSWORD_HASH", passwordHash);
      writeEnvKey(lines, indexMap, "JWT_SECRET",          jwtSecret);
      writeEnvKey(lines, indexMap, "ADMIN_SECRET",        adminSecret);

      // Sona boş satır ekle
      const output = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

      fs.writeFileSync(envPath, output, "utf8");

      server.log.info(`Setup completed — .env written to ${envPath}`);

      return reply.send({
        ok: true,
        message:
          "Setup complete. Restart the API server for changes to take effect.",
      });
    }
  );
}