# ─── Build aşaması ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Önce sadece package.json — bağımlılık layer'ı cache'lenir
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production aşaması ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 -S postgrify && \
    adduser -S postgrify -u 1001

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

USER postgrify

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]