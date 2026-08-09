/**
 * Setup Route — ilk çalıştırma sihirbazı endpoint'leri.
 *
 * GET  /setup/status → { configured: boolean }
 * POST /setup        → admin hesabı + PostgreSQL bağlantısı oluştur
 *
 * Docker davranışı:
 *   Container'da .env dosyasına yazma genellikle başarısız olur (EACCES veya
 *   volume dışı dosya). Bu durumda admin credentials process.env'e inject edilir
 *   (runtime'da çalışır) ve aynı zamanda PostgreSQL DB'ye kalıcı olarak yazılır.
 *   Container restart'ta DB'den yeniden yüklenir — pool plugin onReady hook'u bunu yapar.
 *
 * Güvenlik:
 *   - POST /setup yalnızca bir kez çalışır; sonraki çağrılar 403 döner
 *   - Şifre argon2id ile hash'lenir (memoryCost=64MB, timeCost=3, parallelism=4)
 *   - .env atomik yazma: tmp → rename (yarım yazma önlenir)
 *   - JWT token setup response'unda döner: container'da login endpoint'i
 *     yeni env var'ları görmeyebileceğinden direkt oturum açılır
 */

import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../services/passwordService.js";
import { config } from "../config/env.js";
import { JwtService } from "../services/jwtService.js";

// ── In-memory setup flag ──────────────────────────────────────────────────────
// null   = henüz kontrol edilmedi
// false  = kurulum tamamlanmamış
// true   = kurulum tamamlandı (env var veya DB'den doğrulandı)
let _setupCompleted: boolean | null = null;

/**
 * /setup/status ve POST /setup guard'ı için async kontrol.
 *
 * Doğrulama sırası:
 *   1. In-memory flag → hızlı yol (aynı process içinde setup yapıldıysa)
 *   2. DB'de admin credentials var mı? → güvenilir kaynak.
 *      Bu kontrol env var'ı atlar çünkü `docker compose down -v` volume'ı
 *      siler ama host .env'i silmez — env var'da hash var ama DB'de admin
 *      yoksa setup sayfasının açılması gerekir.
 *   3. DB erişilemiyorsa (decorator yok veya bağlantı hatası) → env var'a bak.
 *      Bu sayede DB olmadan local geliştirme de çalışır.
 */
async function isConfiguredAsync(server?: FastifyInstance): Promise<boolean> {
  // Hızlı yol: aynı process'te setup tamamlandıysa DB'ye gitme
  if (_setupCompleted === true) return true;

  // Güvenilir kaynak: DB'de gerçek admin kaydı var mı?
  if (server?.hasDecorator("settings")) {
    try {
      const creds = await server.settings.getAdminCredentials();
      if (creds) {
        _setupCompleted = true;
        return true;
      }
      // DB erişilebilir ama admin yok → kesinlikle kurulum gerekli
      return false;
    } catch {
      // DB bağlantısı yoksa env var'a fallback (local dev / DB henüz hazır değil)
    }
  }

  // Fallback: env var kontrolü (DB decorator yok veya bağlantı hatası)
  const configured = Boolean(config.ADMIN_EMAIL && config.ADMIN_PASSWORD_HASH);
  if (configured) _setupCompleted = true;
  return configured;
}

/** Setup tamamlandıktan sonra in-memory flag'i günceller. */
function markSetupComplete(): void {
  _setupCompleted = true;
}

/**
 * In-memory _setupCompleted flag'ini null'a sıfırlar.
 *
 * Yalnızca test ortamında kullanılmalıdır.
 * Her test kendi izole server örneği oluşturduğunda state kirlenmesini önler.
 *
 * @internal — test-only
 */
export function _resetSetupFlag(): void {
  _setupCompleted = null;
}

/**
 * .env dosyasına atomik yazma: önce tmp dosyasına yaz, ardından rename.
 * Bu şekilde eş zamanlı isteklerde yarım yazma olmaz.
 */
function writeEnvFileAtomic(envPath: string, content: string): void {
  const tmpPath = path.join(path.dirname(envPath), `.postgrify-env-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
  } catch (err) {
    // Cleanup tmp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

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
    map.set(line.slice(0, eqIdx).trim(), i);
  }
  return map;
}

/**
 * .env dosyasındaki key'leri günceller veya sonuna ekler.
 * Mevcut satırların sırası ve yorumlar korunur.
 */
function updateEnvContent(existing: string, updates: Record<string, string>): string {
  const lines = existing.split("\n");
  const lineIndex = parseEnvFile(existing);

  for (const [key, value] of Object.entries(updates)) {
    const idx = lineIndex.get(key);
    if (idx !== undefined) {
      lines[idx] = `${key}=${value}`;
    } else {
      // Sona ekle (boş satır varsa ondan önce)
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join("\n");
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
      // DB'yi de kontrol et — container restart sonrası env var kaybolmuş olabilir
      const configured = await isConfiguredAsync(server);
      return reply.send({ configured });
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
          additionalProperties: false,
          properties: {
            adminEmail: {
              type: "string",
              format: "email",
              description: "Admin e-posta adresi",
            },
            adminPassword: {
              type: "string",
              minLength: 8,
              description: "Admin şifre (min 8 karakter)",
            },
            pgHost: { type: "string", minLength: 1 },
            pgPort: { type: "integer", minimum: 1, maximum: 65535 },
            pgUser: { type: "string", minLength: 1 },
            pgPassword: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              message: { type: "string" },
              accessToken: { type: "string" },
              refreshToken: { type: "string", nullable: true },
              email: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      // Zaten kurulumlu → kilitli (DB de dahil kontrol et)
      if (await isConfiguredAsync(server)) {
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

      // ── 1. Runtime inject: process.env + config ─────────────────────────────
      // Bu sayede aynı container instance'ında anında login çalışır.
      // Container restart'ta kaybolur; kalıcı kayıt için DB ve .env kullanılır.
      process.env.ADMIN_EMAIL = adminEmail;
      process.env.ADMIN_PASSWORD_HASH = passwordHash;
      process.env.PG_HOST = pgHost;
      process.env.PG_PORT = String(pgPort);
      process.env.PG_USER = pgUser;
      process.env.PG_PASSWORD = pgPassword;

      // config nesnesi de güncellenir — diğer modüller config üzerinden okursa
      // yeniden başlatmaya gerek kalmaz
      (config as Record<string, unknown>).ADMIN_EMAIL = adminEmail;
      (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = passwordHash;
      (config as Record<string, unknown>).PG_HOST = pgHost;
      (config as Record<string, unknown>).PG_PORT = pgPort;
      (config as Record<string, unknown>).PG_USER = pgUser;
      (config as Record<string, unknown>).PG_PASSWORD = pgPassword;

      // ── 2. .env dosyasına yaz (kalıcı — yeniden build'de hayatta kalır) ─────
      let envWritten = false;
      try {
        const envPath = resolveEnvPath();
        const existing = fs.existsSync(envPath)
          ? fs.readFileSync(envPath, "utf8")
          : "";
        const updated = updateEnvContent(existing, {
          ADMIN_EMAIL: adminEmail,
          ADMIN_PASSWORD_HASH: passwordHash,
          PG_HOST: pgHost,
          PG_PORT: String(pgPort),
          PG_USER: pgUser,
          PG_PASSWORD: pgPassword,
        });
        writeEnvFileAtomic(envPath, updated);
        envWritten = true;
        server.log.info({ envPath }, "Setup: .env file updated");
      } catch (err) {
        // Docker container'da .env genellikle yazılamaz — bu beklenen bir durum.
        // Credentials DB'ye yazılır; restart recovery pool plugin'in onReady hook'u yapar.
        server.log.warn(
          { err },
          "Setup: .env write failed (expected in Docker) — credentials will be persisted to DB"
        );
      }

      // ── 3. DB'ye credentials yaz (container restart'ta hayatta kalır) ───────
      // Bu PostgreSQL volume'da kalıcıdır. docker compose down (volume silmeden)
      // → up --build sonrasında pool plugin onReady'de yüklenir.
      if (server.hasDecorator("settings")) {
        try {
          await server.settings.setAdminCredentials(adminEmail, passwordHash);
          await server.settings.setAdminSetupCompleted();
          server.log.info("Setup: admin credentials persisted to DB");
        } catch (dbErr) {
          server.log.warn(
            { err: dbErr },
            "Setup: DB write failed — only env-based detection active"
          );
        }
      }

      // ── 4. In-memory flag güncelle ────────────────────────────────────────
      markSetupComplete();

      // ── 5. JWT token döndür — GUI anında login olsun ─────────────────────
      // Container'da yeni env var'lar /auth/admin/login'de görünmeyebilir
      // (diğer route handler'lar config snapshot'ı alır). Direkt token ile
      // GUI oturumu açar, login endpoint'ine istek atmaz.
      let accessToken: string | undefined;
      let refreshToken: string | null = null;

      try {
        const jwtService = new JwtService(() => config.JWT_SECRET);
        accessToken = await jwtService.signAdminToken(config.ACCESS_TOKEN_EXPIRY, adminEmail);

        // Refresh token varsa (Redis bağlantısı kurulduysa)
        if (server.hasDecorator("sessionService")) {
          try {
            refreshToken = await (server as unknown as { sessionService: { create(email: string): Promise<string | null> } }).sessionService.create(adminEmail);
          } catch {
            // Redis yoksa refresh token olmadan devam et
          }
        }
      } catch (tokenErr) {
        // Token üretimi başarısız olsa da setup başarılı sayılır
        server.log.warn({ err: tokenErr }, "Setup: JWT generation failed");
      }

      const message = envWritten
        ? "Setup complete. Credentials saved to .env and database."
        : "Setup complete. Credentials saved to database (Docker mode — .env not writable).";

      return reply.send({
        ok: true,
        message,
        accessToken,
        refreshToken,
        email: adminEmail,
      });
    }
  );
}