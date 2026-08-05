# ─── Build aşaması ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Önce sadece package.json — bağımlılık layer'ı cache'lenir
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js tailwind.config.ts ./
COPY index.html ./
COPY src ./src

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ─── Production: nginx ile static serve ───────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]