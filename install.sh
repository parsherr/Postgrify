#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
#  Postgrify Installer
#  Kurulan yer: ~/.postgrify/
#  Gereksinimler: curl, Docker (yoksa otomatik kurulur)
# ─────────────────────────────────────────────────────────────

INSTALL_DIR="$HOME/.postgrify"
REPO_RAW="https://raw.githubusercontent.com/parsherr/postgrify/main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[postgrify]${NC} $1"; }
success() { echo -e "${GREEN}[postgrify]${NC} $1"; }
warn()    { echo -e "${YELLOW}[postgrify]${NC} $1"; }
error()   { echo -e "${RED}[postgrify]${NC} $1" >&2; exit 1; }

echo ""
echo -e "${BOLD}  Postgrify Installer${NC}"
echo "  ────────────────────────────────────────"
echo ""

# ── 1. Docker kontrolü ─────────────────────────────────────

if ! command -v docker &>/dev/null; then
    warn "Docker bulunamadı. Kuruluyor..."
    curl -fsSL https://get.docker.com | sh
    # Linux'ta docker grubuna ekle (sudo gerekmeden çalışsın)
    if getent group docker &>/dev/null; then
        sudo usermod -aG docker "$USER" 2>/dev/null || true
    fi
    success "Docker kuruldu."
else
    info "Docker bulundu: $(docker --version | cut -d' ' -f3 | tr -d ',')"
fi

if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose bulunamadı. Docker'ı güncelleyin: https://docs.docker.com/engine/install/"
fi

# ── 2. Kurulum dizini ─────────────────────────────────────

info "Kurulum dizini oluşturuluyor: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ── 3. PostgreSQL şifresi ─────────────────────────────────

echo ""
echo -e "${BOLD}  PostgreSQL Ayarı${NC}"
echo "  ────────────────────────────────────────"
echo "  Postgrify, kendi PostgreSQL container'ını kurar."
echo "  Bu şifre sadece bu kurulum için kullanılır."
echo ""
while true; do
    read -rsp "  PostgreSQL şifresi belirleyin: " PG_PASSWORD
    echo ""
    read -rsp "  Şifreyi tekrar girin: " PG_PASSWORD_CONFIRM
    echo ""
    if [[ "$PG_PASSWORD" == "$PG_PASSWORD_CONFIRM" ]]; then
        break
    fi
    warn "Şifreler eşleşmedi, tekrar deneyin."
done

# ── 4. Secret'ları otomatik üret ─────────────────────────

JWT_SECRET=$(openssl rand -hex 32)
ADMIN_SECRET=$(openssl rand -base64 24 | tr -d '=+/')

# ── 5. .env dosyasını oluştur ────────────────────────────

if [[ -f ".env" ]]; then
    warn ".env zaten mevcut, üzerine yazılmıyor. Sıfırlamak için .env dosyasını silin."
else
    cat > .env << EOF
# Postgrify — otomatik oluşturuldu $(date +%Y-%m-%d)
# Bu dosyayı silmeden önce yedekleyin.

PG_HOST=postgres
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=${PG_PASSWORD}
PG_SSL=false
PG_MAX_POOL_SIZE=10
PG_POOL_IDLE_TIMEOUT=30000
PG_POOL_MAX_LIFETIME=3600000

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=24h

ADMIN_SECRET=${ADMIN_SECRET}

RATE_LIMIT_GLOBAL=1000
RATE_LIMIT_DB=500
RATE_LIMIT_ADMIN=200

PORT=3000
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173

ALLOW_RAW_SQL_ADMIN=true
QUERY_LOG_ENABLED=false
SLOW_QUERY_THRESHOLD_MS=500
EOF
    success ".env oluşturuldu."
fi

# ── 6. docker-compose.yml oluştur ───────────────────────

cat > docker-compose.yml << 'COMPOSE'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile.monorepo
          ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3
    restart: unless-stopped

  gui:
    build:
      context: .
      dockerfile: packages/gui/Dockerfile.monorepo
      args:
        VITE_API_URL: /api
    ports:
      - "5173:80"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
COMPOSE

success "docker-compose.yml oluşturuldu."

# ── 7. Kaynak kodu çek ──────────────────────────────────

if [[ ! -d "packages" ]]; then
    info "Kaynak kod indiriliyor..."
    if ! command -v git &>/dev/null; then
        error "git bulunamadı. Kurmak için: sudo apt install git (Ubuntu) veya brew install git (macOS)"
    fi
    git clone --depth=1 https://github.com/parsherr/postgrify.git _src
    # Tüm packages/ klasörünü kopyala (Dockerfile'lar monorepo context ile çalışıyor)
    # Tüm repoyu kopyala — Dockerfile'lar monorepo root context ile çalışıyor
    cp -r _src/. .
    rm -rf _src
    success "Kaynak kod indirildi."
fi

# ── 8. Build & başlat ───────────────────────────────────

echo ""
info "Container'lar build ediliyor ve başlatılıyor (ilk seferde birkaç dakika sürebilir)..."
docker compose up -d --build

# ── 9. Sağlık kontrolü ──────────────────────────────────

echo ""
info "Servislerin hazır olması bekleniyor..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

# ── 10. Özet ─────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}  ✓ Postgrify kuruldu!${NC}"
echo "  ────────────────────────────────────────"
echo ""
echo -e "  ${BOLD}GUI${NC}          →  http://localhost:5173"
echo -e "  ${BOLD}API${NC}          →  http://localhost:3000"
echo -e "  ${BOLD}API Docs${NC}     →  http://localhost:3000/api-docs"
echo ""
echo -e "  ${BOLD}Admin Secret${NC} →  ${ADMIN_SECRET}"
echo ""
echo -e "  ${YELLOW}Bu bilgileri kaydedin! ADMIN_SECRET daha sonra gösterilmez.${NC}"
echo -e "  ${YELLOW}Tüm ayarlar: ${INSTALL_DIR}/.env${NC}"
echo ""
echo "  Durdurmak için:   cd ~/.postgrify && docker compose down"
echo "  Başlatmak için:   cd ~/.postgrify && docker compose up -d"
echo "  Loglar için:      cd ~/.postgrify && docker compose logs -f"
echo ""