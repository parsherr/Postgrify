#!/usr/bin/env bash
# Postgrify — tek komutlu kurulum scripti
# Kullanım: curl -fsSL https://raw.githubusercontent.com/parsherr/postgrify/main/install.sh | bash
#
# Desteklenen: Linux (Ubuntu/Debian/Fedora/CentOS/Arch), macOS
# Gereksinim: curl, git (yoksa yüklenir), Docker (yoksa yüklenir)
#
# Bu script hiç interaktif girdi istemez — tüm secret'lar otomatik üretilir.
# Admin hesabı web arayüzünden (http://localhost:5173/setup) oluşturulur.

set -euo pipefail

# ─── Renkler ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[postgrify]${NC} $*"; }
success() { echo -e "${GREEN}[postgrify]${NC} $*"; }
warn()    { echo -e "${YELLOW}[postgrify]${NC} $*"; }
error()   { echo -e "${RED}[postgrify]${NC} HATA: $*" >&2; exit 1; }

# OS tespiti
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_FAMILY="${ID_LIKE:-$OS_ID}"
  elif [ "$(uname)" = "Darwin" ]; then
    OS_ID="darwin"
    OS_FAMILY="darwin"
  else
    OS_ID="unknown"
    OS_FAMILY="unknown"
  fi
}

# Komut var mı?
has() { command -v "$1" >/dev/null 2>&1; }

# ─── Docker kurulumu ──────────────────────────────────────────────────────────
install_docker_linux() {
  info "Docker kuruluyor..."

  case "$OS_FAMILY" in
    *debian*|*ubuntu*)
      sudo apt-get update -qq
      sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || \
        curl -fsSL https://download.docker.com/linux/debian/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
$(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    *fedora*|*rhel*|*centos*)
      sudo dnf -y install dnf-plugins-core 2>/dev/null || sudo yum -y install yum-utils
      sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null || \
        sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || \
        sudo yum -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    *arch*)
      sudo pacman -Sy --noconfirm docker docker-compose
      ;;
    *)
      # Evrensel Docker install script
      warn "Dağıtım tanınamadı, Docker'ın resmi install script'i kullanılıyor..."
      curl -fsSL https://get.docker.com | sh
      ;;
  esac

  # Docker daemon'ı başlat
  sudo systemctl enable docker 2>/dev/null || true
  sudo systemctl start docker 2>/dev/null || true

  # Mevcut kullanıcıyı docker grubuna ekle (sudo gerektirmesin)
  if id -nG "$USER" 2>/dev/null | grep -qw docker; then
    : # zaten grupta
  else
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    warn "Kullanıcı docker grubuna eklendi. Yeniden login olmadan docker komutu"
    warn "için bu session'da 'sudo docker' gerekebilir. Script bunu otomatik halleder."
  fi
}

install_docker_mac() {
  error "macOS'ta Docker Desktop manuel kurulumu gereklidir.\nhttps://docs.docker.com/desktop/install/mac-install/\nKurduktan sonra bu scripti tekrar çalıştırın."
}

ensure_docker() {
  if has docker && docker info >/dev/null 2>&1; then
    local ver
    ver=$(docker --version | grep -oP '\d+\.\d+' | head -1)
    success "Docker bulundu: $ver"
    return 0
  fi

  if has docker && ! docker info >/dev/null 2>&1; then
    # Docker kurulu ama daemon çalışmıyor
    warn "Docker daemon çalışmıyor, başlatılıyor..."
    sudo systemctl start docker 2>/dev/null || \
      sudo service docker start 2>/dev/null || \
      error "Docker başlatılamadı. 'sudo systemctl start docker' komutunu manuel çalıştırın."
    sleep 3
    if docker info >/dev/null 2>&1; then
      success "Docker başlatıldı."
      return 0
    fi
    # Belki docker grubundan dolayı permission sorunu, sudo ile dene
    DOCKER_CMD="sudo docker"
    COMPOSE_CMD="sudo docker compose"
    if sudo docker info >/dev/null 2>&1; then
      success "Docker sudo ile erişilebilir."
      return 0
    fi
    error "Docker daemon'a bağlanılamıyor."
  fi

  # Docker hiç yok
  info "Docker bulunamadı, kuruluyor..."
  detect_os
  case "$OS_ID" in
    darwin) install_docker_mac ;;
    *)      install_docker_linux ;;
  esac

  # Kurulum sonrası kontrol — grup değişikliği için newgrp gerekebilir
  if ! docker info >/dev/null 2>&1; then
    if sudo docker info >/dev/null 2>&1; then
      DOCKER_CMD="sudo docker"
      COMPOSE_CMD="sudo docker compose"
      success "Docker kuruldu (sudo ile çalışıyor)."
    else
      error "Docker kuruldu ama başlatılamadı. Sistemi yeniden başlatıp tekrar deneyin."
    fi
  else
    success "Docker kuruldu ve hazır."
  fi
}

ensure_git() {
  if has git; then
    return 0
  fi
  info "git bulunamadı, kuruluyor..."
  detect_os
  case "$OS_FAMILY" in
    *debian*|*ubuntu*) sudo apt-get install -y -qq git ;;
    *fedora*|*rhel*|*centos*) sudo dnf -y install git 2>/dev/null || sudo yum -y install git ;;
    *arch*) sudo pacman -Sy --noconfirm git ;;
    darwin) xcode-select --install 2>/dev/null || true ;;
    *) error "git kurulamadı. Lütfen manuel kurun: https://git-scm.com" ;;
  esac
  has git || error "git kurulumu başarısız."
  success "git kuruldu."
}

ensure_openssl() {
  if has openssl; then
    return 0
  fi
  # openssl yoksa /dev/urandom'dan üret
  OPENSSL_MISSING=1
}

# Random hex string üretimi — openssl varsa güvenli, yoksa /dev/urandom
gen_secret() {
  local len="${1:-32}"
  if has openssl; then
    openssl rand -hex "$len"
  else
    # POSIX uyumlu /dev/urandom okuma
    LC_ALL=C tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c $((len * 2))
  fi
}

# ─── Banner ───────────────────────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${BLUE}"
  echo "  ██████╗  ██████╗ ███████╗████████╗ ██████╗ ██████╗ ██╗███████╗██╗   ██╗"
  echo "  ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔════╝ ██╔══██╗██║██╔════╝╚██╗ ██╔╝"
  echo "  ██████╔╝██║   ██║███████╗   ██║   ██║  ███╗██████╔╝██║█████╗   ╚████╔╝ "
  echo "  ██╔═══╝ ██║   ██║╚════██║   ██║   ██║   ██║██╔══██╗██║██╔══╝    ╚██╔╝  "
  echo "  ██║     ╚██████╔╝███████║   ██║   ╚██████╔╝██║  ██║██║██║        ██║   "
  echo "  ╚═╝      ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝  "
  echo -e "${NC}"
  echo -e "  ${BOLD}Multi-database PostgreSQL Gateway${NC}"
  echo ""
}

# ─── Ana kurulum ──────────────────────────────────────────────────────────────
main() {
  print_banner

  # docker/compose komutları — permission durumuna göre ayarlanır
  DOCKER_CMD="docker"
  COMPOSE_CMD="docker compose"
  OPENSSL_MISSING=0

  detect_os
  ensure_git
  ensure_openssl
  ensure_docker

  # Docker Compose v2 kontrolü (plugin olarak)
  if ! $DOCKER_CMD compose version >/dev/null 2>&1; then
    # v1 standalone docker-compose dene
    if has docker-compose; then
      COMPOSE_CMD="docker-compose"
      warn "Docker Compose v2 bulunamadı, v1 kullanılıyor."
    else
      error "Docker Compose bulunamadı. 'docker compose version' çalışmıyor.\nDocker'ı güncelleyin: https://docs.docker.com/compose/install/"
    fi
  fi

  # ─── Kurulum dizini ─────────────────────────────────────────────────────────
  INSTALL_DIR="${POSTGRIFY_DIR:-$HOME/.postgrify}"
  info "Kurulum dizini: $INSTALL_DIR"

  if [ -d "$INSTALL_DIR" ]; then
    if [ -f "$INSTALL_DIR/packages/docker-compose.yml" ]; then
      warn "Postgrify zaten kurulu: $INSTALL_DIR"
      warn "Güncellemek için: cd $INSTALL_DIR && git pull && cd packages && $COMPOSE_CMD up -d --build"
      echo ""
      warn "Sıfırdan kurmak için: rm -rf $INSTALL_DIR ve tekrar çalıştırın."
      exit 0
    fi
    # Dizin var ama eksik — temizle
    rm -rf "$INSTALL_DIR"
  fi

  # ─── Repo klonla ────────────────────────────────────────────────────────────
  info "Postgrify indiriliyor..."
  git clone --depth 1 https://github.com/parsherr/postgrify.git "$INSTALL_DIR" 2>&1 | \
    grep -v "^remote:" | grep -v "^Cloning" || true
  success "İndirildi: $INSTALL_DIR"

  # ─── .env oluştur ───────────────────────────────────────────────────────────
  info "Ortam değişkenleri oluşturuluyor..."

  local PG_PASSWORD JWT_SECRET ADMIN_SECRET
  PG_PASSWORD=$(gen_secret 24)
  JWT_SECRET=$(gen_secret 32)
  ADMIN_SECRET=$(gen_secret 16)

  cat > "$INSTALL_DIR/packages/.env" <<EOF
# Postgrify — otomatik oluşturuldu: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Bu dosyayı silmeyin — tüm servisler buraya bağlı.

# ── PostgreSQL (container) ───────────────────────────────────────────────────
PG_HOST=postgres
PG_PORT=5432
PG_USER=postgrify
PG_PASSWORD=${PG_PASSWORD}
PG_SSL=false

# ── Güvenlik ─────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
ADMIN_SECRET=${ADMIN_SECRET}

# ── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── Uygulama ─────────────────────────────────────────────────────────────────
NODE_ENV=production
LOG_LEVEL=info
APP_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173

# ── Özellikler ────────────────────────────────────────────────────────────────
ALLOW_RAW_SQL_ADMIN=false
EOF

  success ".env oluşturuldu."

  # ─── Servisleri başlat ──────────────────────────────────────────────────────
  info "Docker imajları derleniyor ve servisler başlatılıyor..."
  info "(Bu işlem ilk seferinde 3-10 dakika sürebilir)"
  echo ""

  cd "$INSTALL_DIR/packages"

  if ! $COMPOSE_CMD up -d --build 2>&1; then
    echo ""
    error "Docker Compose başarısız. Logları görmek için:\n  cd $INSTALL_DIR/packages && ${COMPOSE_CMD} logs"
  fi

  # ─── Servis hazır olmasını bekle ────────────────────────────────────────────
  info "Servisler hazır olana kadar bekleniyor..."
  local max_wait=120
  local elapsed=0
  local ready=0

  while [ $elapsed -lt $max_wait ]; do
    if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
      ready=1
      break
    fi
    printf "."
    sleep 3
    elapsed=$((elapsed + 3))
  done
  echo ""

  if [ $ready -eq 0 ]; then
    warn "API $max_wait saniye içinde hazır olmadı."
    warn "Logları kontrol edin: cd $INSTALL_DIR/packages && ${COMPOSE_CMD} logs api"
  fi

  # ─── Tamamlandı ─────────────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${GREEN}  Postgrify kurulumu tamamlandı!${NC}"
  echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${BOLD}Web arayüzü:${NC}  http://localhost:5173"
  echo -e "  ${BOLD}API:${NC}          http://localhost:3000"
  echo ""
  echo -e "  ${BOLD}İlk adım:${NC} Tarayıcıda http://localhost:5173/setup adresini"
  echo -e "           açın ve admin hesabınızı oluşturun."
  echo ""
  echo -e "  ${BOLD}Komutlar:${NC}"
  echo -e "    Durdur:   cd $INSTALL_DIR/packages && ${COMPOSE_CMD} down"
  echo -e "    Başlat:   cd $INSTALL_DIR/packages && ${COMPOSE_CMD} up -d"
  echo -e "    Güncelle: cd $INSTALL_DIR && git pull && cd packages && ${COMPOSE_CMD} up -d --build"
  echo -e "    Loglar:   cd $INSTALL_DIR/packages && ${COMPOSE_CMD} logs -f"
  echo ""
  echo -e "  ${BOLD}Kurulum dizini:${NC} $INSTALL_DIR"
  echo ""
}

main "$@"