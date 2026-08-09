---
name: active
description: Şu anki görev durumu
metadata:
  type: project
---

# Now
Güvenlik düzeltmeleri tamamlandı — 444/444 test geçiyor, TypeScript hatasız.

# Done (Güvenlik)
- KRIT-4: env.ts — production'da placeholder JWT_SECRET/ADMIN_SECRET → process.exit(1)
- KRIT-3: databases.ts:141 — pg_terminate_backend $1 parametrik query
- KRIT-2: rateLimit.ts — ioredis backend (Redis varsa distributed, yoksa in-memory fallback)
- KRIT-1: terminal.ts — TERMINAL_ENABLED flag, env cleanup (JWT_SECRET/PG_PASSWORD temizlendi), token ilk WS mesajından alınıyor
- HIGH-3: passwordReset.ts + magicLink.ts — SHA-256 hash token storage; users.ts metadata filtreleme
- HIGH-1 + HIGH-2: oauth.ts — token URL fragment'a taşındı, open redirect origin whitelist eklendi
- HIGH-4: oauth.ts — Redis-backed state store (in-memory fallback)
- MED-5: nginx.conf — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP, Permissions-Policy
- MED-6: docker-compose.yml — Redis requirepass, env.ts TERMINAL_ENABLED flag
- MED-3: query.ts — QUERY_LOG_ENABLED raw SQL audit log
- VERI-1: scripts/reset-admin.ts — emergency admin CLI aracı
- Güvenlik test suite: test/security/ (7 dosya, 104 güvenlik testi)
- 444 test geçiyor (37 test dosyası)

# Next
- docker compose up -d --build ile uçtan uca test
- .env.example REDIS_PASSWORD, TERMINAL_ENABLED alanlarını güncelle
- packages/.env'e REDIS_PASSWORD ekle