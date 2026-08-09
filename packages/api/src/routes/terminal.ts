/**
 * Terminal WebSocket route — gerçek PTY bağlantısı.
 *
 * GET /terminal/ws
 *
 * Güvenlik değişiklikleri:
 *   - TERMINAL_ENABLED=false (varsayılan) iken endpoint 403 döner.
 *     Production'da bu flag açıkça true olarak set edilmeli.
 *   - Token query param'dan değil WebSocket ilk mesajından alınır.
 *     Query param (?token=) nginx/proxy access log'larına düştüğü için
 *     kullanımı kaldırıldı.
 *   - Shell env'i temizlenir: JWT_SECRET, PG_PASSWORD, ADMIN_SECRET ve
 *     diğer hassas değişkenler forward edilmez.
 *
 * Protokol (JSON mesajlar):
 *   Client → Server:
 *     { type: "auth",   token: string }               — ilk mesaj, zorunlu
 *     { type: "input",  data: string }                — klavye girdisi
 *     { type: "resize", cols: number, rows: number }  — terminal boyutu
 *
 *   Server → Client:
 *     { type: "output", data: string }   — PTY çıktısı
 *     { type: "exit",   code: number }   — process çıkışı
 *     { type: "error",  message: string } — bağlantı hatası
 */

import type { FastifyInstance } from "fastify";
import type { SocketStream } from "@fastify/websocket";
import { JwtService } from "../services/jwtService.js";
import { config } from "../config/env.js";

// Hassas env değişkenlerini shell ortamından çıkar.
// Bu liste tam değil — spawn sırasında dinamik olarak env temizlenir.
const SENSITIVE_ENV_KEYS = new Set([
  "JWT_SECRET",
  "ADMIN_SECRET",
  "PG_PASSWORD",
  "SMTP_PASS",
  "REDIS_URL",
  "DB_SECRET",
  // DB_SECRET_* prefix'li tüm değişkenler de aşağıda temizlenir
]);

/**
 * process.env'den hassas değişkenleri çıkararak güvenli bir env objesi döner.
 */
function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Bilinen hassas key'ler
    if (SENSITIVE_ENV_KEYS.has(key)) continue;
    // DB_SECRET_* prefix'li tüm per-DB secret'lar
    if (key.startsWith("DB_SECRET_")) continue;
    // npm/node iç değişkenleri forward etme (bilgi sızıntısı riski)
    if (key.startsWith("npm_")) continue;
    safe[key] = value;
  }
  // PTY için zorunlu minimum değişkenler
  safe.TERM = "xterm-256color";
  safe.COLORTERM = "truecolor";
  return safe;
}

// node-pty dinamik import — tip tanımları
type IPty = import("node-pty").IPty;

function send(connection: SocketStream, msg: object) {
  if (connection.socket.readyState === connection.socket.OPEN) {
    connection.socket.send(JSON.stringify(msg));
  }
}

export async function terminalRoutes(server: FastifyInstance) {
  // ──────────────────────────────────────────────────────────────────────────
  // GÜVENLİK: Terminal kalıcı olarak devre dışı bırakıldı.
  //
  // Terminal WebSocket'i admin JWT ile tam shell erişimi sağlıyor:
  //   - process.env tamamen forward edilebilir (JWT_SECRET, PG_PASSWORD vs.)
  //   - Container dosya sistemine tam erişim
  //   - Token çalınırsa rm -rf, DB dump, secret exfil mümkün
  //
  // Yeniden aktifleştirmek için:
  //   1. Bu satırı kaldırın:  const terminalEnabled = false;
  //   2. Şunu uncomment edin: const terminalEnabled = (process.env.TERMINAL_ENABLED ?? "false") === "true";
  //   3. Aynı zamanda: shell sandbox (chroot/bubblewrap), command allowlist,
  //      WebSocket sub-protocol auth (query param yerine) ekleyin.
  //
  // TERMINAL_ENABLED env flag'i artık dikkate alınmıyor — kasıtlı.
  // ──────────────────────────────────────────────────────────────────────────
  const terminalEnabled = false; // Hardcode disabled — env flag override edemez
  // const terminalEnabled = (process.env.TERMINAL_ENABLED ?? "false") === "true";

  if (!terminalEnabled) {
    server.get(
      "/ws",
      { websocket: true },
      (connection: SocketStream) => {
        send(connection, {
          type: "error",
          message: "Terminal is permanently disabled for security reasons.",
        });
        connection.socket.close(4403, "Terminal disabled");
      }
    );
    server.log.warn("[terminal] Terminal WebSocket is DISABLED (TERMINAL_ENABLED != true)");
    return;
  }

  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.get(
    "/ws",
    { websocket: true },
    async (connection: SocketStream, req) => {
      const socket = connection.socket;

      // Auth timeout — ilk mesaj 10 saniye içinde gelmezse bağlantıyı kes
      let authenticated = false;
      let pty: IPty | null = null;

      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          send(connection, { type: "error", message: "Authentication timeout" });
          socket.close(4401, "Auth timeout");
        }
      }, 10_000);

      // ── client → PTY ──────────────────────────────────────────────────────
      socket.on("message", async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string;
            token?: string;
            data?: string;
            cols?: number;
            rows?: number;
          };

          // ── İlk mesaj: auth ──────────────────────────────────────────────
          if (!authenticated) {
            if (msg.type !== "auth" || !msg.token) {
              send(connection, { type: "error", message: "First message must be { type: 'auth', token: '<jwt>' }" });
              socket.close(4401, "Unauthorized");
              return;
            }

            const payload = await jwtService.verify(msg.token);
            if (!payload || payload.role !== "admin") {
              send(connection, { type: "error", message: "Admin token required" });
              socket.close(4403, "Forbidden");
              return;
            }

            clearTimeout(authTimeout);
            authenticated = true;
            server.log.info(`[terminal] Authenticated (sub=${payload.sub})`);

            // ── PTY spawn ──────────────────────────────────────────────────
            try {
              const nodePty = await import("node-pty");
              // Alpine'da bash yoksa sh'a düş
              const preferredShell = process.env.SHELL ?? "/bin/bash";
              const { existsSync } = await import("node:fs");
              const shell = existsSync(preferredShell) ? preferredShell : "/bin/sh";

              pty = nodePty.spawn(shell, [], {
                name: "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: "/tmp",
                // Sadece temizlenmiş env — secret'lar forward edilmez
                env: buildSafeEnv(),
              });

              server.log.info(`[terminal] PTY spawned (pid=${pty.pid})`);

              pty.onData((data) => {
                send(connection, { type: "output", data });
              });

              pty.onExit(({ exitCode }) => {
                server.log.info(`[terminal] PTY exited (code=${exitCode})`);
                send(connection, { type: "exit", code: exitCode });
                if (socket.readyState === socket.OPEN) socket.close(1000, "Process exited");
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              server.log.error(`[terminal] PTY spawn failed: ${errMsg}`);
              send(connection, { type: "error", message: `PTY spawn failed: ${errMsg}` });
              socket.close(1011, "PTY error");
            }
            return;
          }

          // ── Sonraki mesajlar: input / resize ─────────────────────────────
          if (!pty) return;

          if (msg.type === "input" && typeof msg.data === "string") {
            pty.write(msg.data);
          } else if (
            msg.type === "resize" &&
            typeof msg.cols === "number" &&
            typeof msg.rows === "number"
          ) {
            pty.resize(
              Math.max(1, Math.min(msg.cols, 512)),
              Math.max(1, Math.min(msg.rows, 256))
            );
          }
        } catch {
          // JSON parse hatası — yoksay
        }
      });

      // ── cleanup ───────────────────────────────────────────────────────────
      socket.on("close", () => {
        clearTimeout(authTimeout);
        if (pty) {
          try {
            pty.kill();
            server.log.info("[terminal] PTY killed on WS close");
          } catch {
            // zaten ölmüş olabilir
          }
          pty = null;
        }
      });

      socket.on("error", (err: Error) => {
        server.log.warn(`[terminal] WS error: ${err.message}`);
      });
    }
  );
}