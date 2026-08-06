/**
 * ShellTerminal — xterm.js + WebSocket PTY.
 * Her mount'ta yeni WS bağlantısı açar, unmount'ta kapatır.
 */

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { BASE_URL } from "../../lib/api";
import { useAuthContext } from "../../hooks/useAuthContext";

interface Props {
  /** Panel içindeki kapsayıcı aktif mi (görünür mü) */
  active: boolean;
}

/** http(s) → ws(s) dönüşümü.
 *  base="/api", path="/terminal/ws" → ws://host/api/terminal/ws
 *  base="http://localhost:3000", path="/terminal/ws" → ws://localhost:3000/terminal/ws
 */
function toWsUrl(base: string, path: string): string {
  // base relative ise (örn. "/api") → origin + base + path birleştir
  const fullBase = base.startsWith("/")
    ? `${window.location.origin}${base}`
    : base;
  // base'in trailing slash'ini kaldır, path'in leading slash'ini koru
  const normalizedBase = fullBase.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function ShellTerminal({ active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { getAccessToken } = useAuthContext();

  useEffect(() => {
    if (!containerRef.current) return;

    // Terminal init
    const term = new Terminal({
      fontFamily: '"GeistMono", "JetBrains Mono", "Cascadia Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#a1a1aa",
        selectionBackground: "#3f3f46",
        black: "#18181b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#f4f4f5",
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // WebSocket bağlantısı — memory'deki access token
    const token = getAccessToken() ?? "";
    const wsUrl = toWsUrl(BASE_URL, `/terminal/ws?token=${encodeURIComponent(token)}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // İlk boyutu gönder
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data?: string;
          code?: number;
          message?: string;
        };
        if (msg.type === "output" && msg.data) {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[90m[process exited with code ${msg.code ?? 0}]\x1b[0m`);
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m`);
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[WebSocket connection error]\x1b[0m");
    };

    ws.onclose = (ev) => {
      if (ev.code !== 1000) {
        term.writeln(`\r\n\x1b[90m[disconnected: ${ev.reason || ev.code}]\x1b[0m`);
      }
    };

    // Kullanıcı girdisi → WS
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      const dims = fitRef.current.proposeDimensions();
      if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      ws.close(1000, "component unmounted");
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // active değişince fit çalıştır (panel açıldığında)
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => fitRef.current?.fit(), 50);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#09090b]"
      style={{ padding: "4px 2px" }}
    />
  );
}