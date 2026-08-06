/**
 * Terminal WebSocket route — gerçek PTY bağlantısı.
 *
 * GET /terminal/ws?token=<jwt>
 *
 * Protokol (JSON mesajlar):
 *   Client → Server:
 *     { type: "input",  data: string }          — klavye girdisi
 *     { type: "resize", cols: number, rows: number }  — terminal boyutu
 *
 *   Server → Client:
 *     { type: "output", data: string }           — PTY çıktısı
 *     { type: "exit",   code: number }           — process çıkışı
 *     { type: "error",  message: string }        — bağlantı hatası
 *
 * Auth: Bearer header VEYA ?token= query param (WS bağlantısında header
 * kolay geçilemediği için query param desteklenir; admin token gerekir).
 */

import type { FastifyInstance } from "fastify";
import type { SocketStream } from "@fastify/websocket";
import { JwtService } from "../services/jwtService.js";
import { config } from "../config/env.js";

// node-pty dinamik import — tip tanımları
type IPty = import("node-pty").IPty;

function send(connection: SocketStream, msg: object) {
  if (connection.socket.readyState === connection.socket.OPEN) {
    connection.socket.send(JSON.stringify(msg));
  }
}

export async function terminalRoutes(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  server.get(
    "/ws",
    { websocket: true },
    async (connection: SocketStream, req) => {
      const socket = connection.socket;

      // ── Auth ──────────────────────────────────────────────────────────────
      const rawToken =
        (req.query as Record<string, string>).token ??
        req.headers.authorization?.replace("Bearer ", "");

      if (!rawToken) {
        send(connection, { type: "error", message: "Missing token" });
        socket.close(4401, "Unauthorized");
        return;
      }

      const payload = await jwtService.verify(rawToken);
      if (!payload || payload.role !== "admin") {
        send(connection, { type: "error", message: "Admin token required" });
        socket.close(4403, "Forbidden");
        return;
      }

      // ── PTY spawn ─────────────────────────────────────────────────────────
      let pty: IPty | null = null;

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
          cwd: process.env.HOME ?? "/tmp",
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });

        server.log.info(`[terminal] PTY spawned (pid=${pty.pid})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        server.log.error(`[terminal] PTY spawn failed: ${msg}`);
        send(connection, { type: "error", message: `PTY spawn failed: ${msg}` });
        socket.close(1011, "PTY error");
        return;
      }

      // ── PTY → client ──────────────────────────────────────────────────────
      pty.onData((data) => {
        send(connection, { type: "output", data });
      });

      pty.onExit(({ exitCode }) => {
        server.log.info(`[terminal] PTY exited (code=${exitCode})`);
        send(connection, { type: "exit", code: exitCode });
        if (socket.readyState === socket.OPEN) socket.close(1000, "Process exited");
      });

      // ── client → PTY ──────────────────────────────────────────────────────
      socket.on("message", (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string;
            data?: string;
            cols?: number;
            rows?: number;
          };

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