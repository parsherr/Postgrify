# ─── Build aşaması ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Monorepo root package.json + lock (workspace bağımlılıkları için)
COPY package.json package-lock.json* ./
COPY packages/gui/package.json ./packages/gui/

# Sadece gui workspace bağımlılıklarını yükle
RUN npm ci --workspace=packages/gui --ignore-scripts

# Config dosyaları
COPY packages/gui/tsconfig.json packages/gui/tsconfig.node.json ./packages/gui/
COPY packages/gui/vite.config.ts packages/gui/postcss.config.js packages/gui/tailwind.config.js ./packages/gui/
COPY packages/gui/index.html ./packages/gui/

# Kaynak kod ve public assets
COPY packages/gui/src ./packages/gui/src
COPY packages/gui/public ./packages/gui/public

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/packages/gui
RUN npm run build

# ─── Production: nginx ile static serve ───────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/packages/gui/dist /usr/share/nginx/html
COPY packages/gui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]