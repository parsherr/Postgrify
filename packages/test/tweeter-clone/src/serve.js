/**
 * serve.js — Basit HTTP Sunucu
 *
 * Static dosyalar + Postgrify API'ye proxy görevi görür.
 * CORS sorununu önlemek için API istekleri bu sunucu üzerinden iletilir.
 *
 * Çalıştırmak: node src/serve.js
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/**
 * Postgrify API'ye proxy isteği iletir.
 * /api/* → config.apiUrl/*
 */
function proxyToPostgrify(req, res) {
  const targetPath = req.url.replace('/api', '');
  const targetUrl = new URL(targetPath, config.apiUrl);

  const proxyReq = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 3000,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy hatası:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Postgrify API\'ye ulaşılamadı', detail: err.message }));
  });

  req.pipe(proxyReq);
}

/**
 * Static dosya sun.
 */
function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // Güvenlik: public dir dışına çıkma
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Bulunamazsa index.html'e düş (SPA fallback)
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data2);
        });
        return;
      }
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // CORS başlıkları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    proxyToPostgrify(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(config.port, () => {
  console.log(`🐦 Tweeter Clone çalışıyor: http://localhost:${config.port}`);
  console.log(`   Postgrify API: ${config.apiUrl}`);
  console.log('');
  console.log('Not: Önce setup.js çalıştırdığınızdan emin olun.');
});