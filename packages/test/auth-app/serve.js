/**
 * Minimal HTTP server — auth-app'i localhost'tan serve eder.
 * CORS sorunu olmadan file:// yerine http://localhost:8080 üzerinden çalışır.
 *
 * Kullanım: node serve.js
 * Sonra aç: http://localhost:8080
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✓ Auth App çalışıyor → http://localhost:${PORT}\n`);
  console.log(`  Test kullanıcısı: testuser@example.com / testpass123`);
  console.log(`  Ctrl+C ile durdur\n`);
});