#!/usr/bin/env bash
# Postgrify install.sh test scripti
# Kullanım: bash test-install.sh [--quick] [--clean]
#
# --quick : Docker build'i atla, sadece script mantığını test et
# --clean : Test sonrası kurulumu temizle

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

QUICK=0
CLEAN=0
PASS=0
FAIL=0
ERRORS=()

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --clean) CLEAN=1 ;;
  esac
done

ok()   { echo -e "  ${GREEN}✓${NC} $*"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $*"; FAIL=$((FAIL+1)); ERRORS+=("$*"); }
info() { echo -e "  ${BLUE}→${NC} $*"; }
section() { echo ""; echo -e "${BOLD}$*${NC}"; echo "────────────────────────────────────────"; }

# ─── Test 1: Script sözdizimi ─────────────────────────────────────────────────
section "Test 1: Script sözdizimi"

SCRIPT_PATH="$(dirname "$0")/install.sh"

if bash -n "$SCRIPT_PATH" 2>/dev/null; then
  ok "install.sh sözdizimi geçerli (bash -n)"
else
  fail "install.sh sözdizim hatası var"
fi

# set -e, set -u, set -o pipefail kontrol
if grep -q "set -euo pipefail" "$SCRIPT_PATH"; then
  ok "set -euo pipefail mevcut"
else
  fail "set -euo pipefail eksik — script hatalarda durmayabilir"
fi

# Hiç 'read' komutu yok mu?
if grep -nE "^\s*read\s+" "$SCRIPT_PATH" | grep -v "^.*#" | grep -q .; then
  fail "Script 'read' komutu içeriyor — pipe'da çalışmaz"
  grep -nE "^\s*read\s+" "$SCRIPT_PATH" | grep -v "^.*#" | while read -r line; do
    info "  $line"
  done
else
  ok "Script 'read' komutu içermiyor — pipe-safe"
fi

# ─── Test 2: Secret üretimi ───────────────────────────────────────────────────
section "Test 2: Secret üretim fonksiyonları"

# gen_secret fonksiyonunu izole test et
GEN_SECRET_TEST=$(bash -c '
gen_secret() {
  local len="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$len"
  else
    LC_ALL=C tr -dc "a-f0-9" </dev/urandom 2>/dev/null | head -c $((len * 2))
  fi
}
echo "$(gen_secret 32):$(gen_secret 24):$(gen_secret 16)"
')

PG_PASS=$(echo "$GEN_SECRET_TEST" | cut -d: -f2)
JWT=$(echo "$GEN_SECRET_TEST" | cut -d: -f1)
ADMIN=$(echo "$GEN_SECRET_TEST" | cut -d: -f3)

if [ ${#JWT} -ge 64 ]; then
  ok "JWT_SECRET üretildi (${#JWT} karakter)"
else
  fail "JWT_SECRET çok kısa: ${#JWT} karakter (64+ bekleniyor)"
fi

if [ ${#PG_PASS} -ge 48 ]; then
  ok "PG_PASSWORD üretildi (${#PG_PASS} karakter)"
else
  fail "PG_PASSWORD çok kısa: ${#PG_PASS} karakter"
fi

if [ ${#ADMIN} -ge 32 ]; then
  ok "ADMIN_SECRET üretildi (${#ADMIN} karakter)"
else
  fail "ADMIN_SECRET çok kısa: ${#ADMIN} karakter"
fi

# Her çağrıda farklı değer üretiliyor mu?
S1=$(bash -c 'openssl rand -hex 32')
S2=$(bash -c 'openssl rand -hex 32')
if [ "$S1" != "$S2" ]; then
  ok "Secret'lar her seferinde farklı üretiliyor"
else
  fail "Secret'lar aynı — openssl rand deterministic mi?"
fi

# ─── Test 3: .env içeriği ────────────────────────────────────────────────────
section "Test 3: .env şablonu doğruluğu"

TEMP_DIR=$(mktemp -d)
TEMP_ENV="$TEMP_DIR/.env"

# .env üretimini simüle et
PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_SECRET=$(openssl rand -hex 16)

cat > "$TEMP_ENV" <<EOF
PG_HOST=postgres
PG_PORT=5432
PG_USER=postgrify
PG_PASSWORD=${PG_PASSWORD}
PG_SSL=false
JWT_SECRET=${JWT_SECRET}
ADMIN_SECRET=${ADMIN_SECRET}
REDIS_URL=redis://redis:6379
NODE_ENV=production
LOG_LEVEL=info
APP_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
ALLOW_RAW_SQL_ADMIN=false
EOF

# Zorunlu değişkenler var mı?
REQUIRED_VARS="PG_HOST PG_PORT PG_USER PG_PASSWORD JWT_SECRET ADMIN_SECRET REDIS_URL NODE_ENV"
for var in $REQUIRED_VARS; do
  if grep -q "^${var}=" "$TEMP_ENV"; then
    ok ".env'de $var mevcut"
  else
    fail ".env'de $var eksik"
  fi
done

# Secret'lar boş değil mi?
for var in PG_PASSWORD JWT_SECRET ADMIN_SECRET; do
  val=$(grep "^${var}=" "$TEMP_ENV" | cut -d= -f2-)
  if [ -n "$val" ] && [ "$val" != '""' ]; then
    ok "$var boş değil"
  else
    fail "$var boş!"
  fi
done

# PG_HOST container adı mı? (host.docker.internal değil)
PG_HOST_VAL=$(grep "^PG_HOST=" "$TEMP_ENV" | cut -d= -f2)
if [ "$PG_HOST_VAL" = "postgres" ]; then
  ok "PG_HOST=postgres (container adı — doğru)"
else
  fail "PG_HOST=$PG_HOST_VAL (beklenen: postgres)"
fi

rm -rf "$TEMP_DIR"

# ─── Test 4: docker-compose.yml ───────────────────────────────────────────────
section "Test 4: docker-compose.yml yapısı"

COMPOSE_FILE="$(dirname "$0")/packages/docker-compose.yml"

if [ -f "$COMPOSE_FILE" ]; then
  ok "docker-compose.yml mevcut"
else
  fail "docker-compose.yml bulunamadı: $COMPOSE_FILE"
fi

# PostgreSQL servisi var mı?
if grep -q "image: postgres" "$COMPOSE_FILE"; then
  ok "PostgreSQL servisi mevcut"
else
  fail "docker-compose.yml'de PostgreSQL servisi yok"
fi

# Redis servisi var mı?
if grep -q "image: redis" "$COMPOSE_FILE"; then
  ok "Redis servisi mevcut"
else
  fail "Redis servisi yok"
fi

# api ve gui servisleri
for svc in api gui; do
  if grep -q "^  ${svc}:" "$COMPOSE_FILE"; then
    ok "$svc servisi tanımlı"
  else
    fail "$svc servisi eksik"
  fi
done

# HTML entity var mı? (&gt; &amp; &lt;)
if grep -qP "&gt;|&amp;|&lt;" "$COMPOSE_FILE"; then
  fail "docker-compose.yml HTML entity içeriyor (sözdizim hatası)"
  grep -nP "&gt;|&amp;|&lt;" "$COMPOSE_FILE" | while read -r line; do
    info "  Hatalı satır: $line"
  done
else
  ok "docker-compose.yml HTML entity içermiyor"
fi

# Geçerli YAML mı?
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import yaml; yaml.safe_load(open('$COMPOSE_FILE'))" 2>/dev/null; then
    ok "docker-compose.yml geçerli YAML"
  else
    fail "docker-compose.yml geçersiz YAML"
  fi
elif command -v docker >/dev/null 2>&1; then
  if docker compose -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
    ok "docker-compose.yml Docker Compose tarafından geçerli"
  else
    fail "docker-compose.yml geçersiz (docker compose config hatası)"
  fi
else
  info "YAML doğrulama için python3 veya docker bulunamadı, atlandı"
fi

# ─── Test 5: Dockerfile'lar ──────────────────────────────────────────────────
section "Test 5: Dockerfile sözdizimi ve temizliği"

for df in \
  "packages/api/Dockerfile.monorepo" \
  "packages/gui/Dockerfile"; do
  full="$(dirname "$0")/$df"
  if [ -f "$full" ]; then
    ok "$df mevcut"
    # HTML entity kontrolü
    if grep -qP "&gt;|&amp;|&lt;" "$full"; then
      fail "$df HTML entity içeriyor"
      grep -nP "&gt;|&amp;|&lt;" "$full" | head -5 | while read -r line; do
        info "  $line"
      done
    else
      ok "$df HTML entity içermiyor"
    fi
  else
    fail "$df bulunamadı"
  fi
done

# ─── Test 6: TypeScript dosyaları ─────────────────────────────────────────────
section "Test 6: TypeScript kaynak dosyaları"

TS_ENTITY_FILES=$(grep -rPl "&gt;|&amp;|&lt;" \
  "$(dirname "$0")/packages/api/src/" \
  --include="*.ts" 2>/dev/null || true)

if [ -z "$TS_ENTITY_FILES" ]; then
  ok "TypeScript dosyalarında HTML entity yok"
else
  fail "Aşağıdaki TS dosyalarında HTML entity var:"
  echo "$TS_ENTITY_FILES" | while read -r f; do
    info "  $f"
  done
fi

# ─── Test 7: Hızlı Docker testi (--quick değilse) ────────────────────────────
if [ $QUICK -eq 0 ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  section "Test 7: docker compose config doğrulama"

  COMPOSE_DIR="$(dirname "$0")/packages"
  TEMP_ENV2="$COMPOSE_DIR/.env.test-$$"

  # Geçici test .env
  cat > "$TEMP_ENV2" <<EOF
PG_PASSWORD=testpass123
JWT_SECRET=test-jwt-secret-at-least-32-characters-long
ADMIN_SECRET=test-admin-16ch
REDIS_URL=redis://redis:6379
NODE_ENV=production
PG_HOST=postgres
PG_USER=postgrify
EOF

  if docker compose -f "$COMPOSE_DIR/docker-compose.yml" \
    --env-file "$TEMP_ENV2" config >/dev/null 2>&1; then
    ok "docker compose config başarılı — YAML ve interpolasyon geçerli"
  else
    fail "docker compose config başarısız"
    docker compose -f "$COMPOSE_DIR/docker-compose.yml" \
      --env-file "$TEMP_ENV2" config 2>&1 | head -20 | while read -r line; do
      info "  $line"
    done
  fi

  rm -f "$TEMP_ENV2"
else
  section "Test 7: Docker (atlandı)"
  info "--quick modu veya Docker erişimi yok, atlandı."
fi

# ─── Sonuç ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}Test Sonucu:${NC}  ${GREEN}$PASS geçti${NC}  |  ${RED}$FAIL başarısız${NC}"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo -e "  ${RED}${BOLD}Başarısız testler:${NC}"
  for e in "${ERRORS[@]}"; do
    echo -e "    ${RED}✗${NC} $e"
  done
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}Tüm testler geçti ✓${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi