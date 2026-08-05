# ─── Build aşaması ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Bağımlılık dosyaları — lock dosyası root'tan kopyalanır (monorepo workspace)
COPY package.json package-lock.json* ./

# npm ci: lock dosyasından hızlı deterministik yükleme
# --ignore-scripts: postinstall scriptlerini atla (güvenlik + hız)
RUN npm ci --ignore-scripts

# Config dosyaları
COPY tsconfig.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js tailwind.config.ts ./
COPY index.html ./

# Kaynak kod — en son kopyala (sık değişir, önceki layer'lar cache'lenir)
COPY src ./src

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ─── Production: nginx ile static serve ───────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]