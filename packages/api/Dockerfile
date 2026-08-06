# ─── Build aşaması ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# node-pty native build için gerekli araçlar
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Önce sadece package.json — bağımlılık layer'ı cache'lenir
COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production aşaması ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Runtime araçlar — her biri ayrı RUN satırı (hata görünür olsun)
RUN apk update
RUN apk add --no-cache bash libstdc++ curl jq wget
# postgresql-client: Alpine 3.x'te paket adı değişebilir, iki isim deneniyor
RUN apk add --no-cache postgresql-client 2>/dev/null || \
    apk add --no-cache postgresql16-client 2>/dev/null || \
    apk add --no-cache postgresql17-client 2>/dev/null || \
    echo "WARNING: postgresql-client could not be installed"

ENV SHELL=/bin/bash

WORKDIR /app

RUN addgroup -g 1001 -S postgrify && \
    adduser -S postgrify -u 1001

COPY package.json ./

# node_modules'u builder'dan kopyala — node-pty native binary zaten derlenmiş
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER postgrify

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]