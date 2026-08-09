#!/usr/bin/env bash
# scripts/release.sh — Postgrify release helper
#
# Kullanım:
#   ./scripts/release.sh patch   # 0.1.0 → 0.1.1
#   ./scripts/release.sh minor   # 0.1.0 → 0.2.0
#   ./scripts/release.sh major   # 0.1.0 → 1.0.0
#
# Ne yapar:
#   1. packages/api ve packages/gui package.json version'larını bump eder
#   2. CHANGELOG.md'e yeni section ekler (son tag'den bu yana git log)
#   3. git commit + git tag oluşturur
#   4. Push talimatını ekrana basar

set -euo pipefail

BUMP="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PKG="$REPO_ROOT/packages/api/package.json"
GUI_PKG="$REPO_ROOT/packages/gui/package.json"
CHANGELOG="$REPO_ROOT/CHANGELOG.md"

# ── Yardımcılar ────────────────────────────────────────────────────────────────

usage() {
  echo "Kullanım: $(basename "$0") patch|minor|major"
  exit 1
}

# x.y.z formatında version bump
bump_version() {
  local current="$1"
  local bump_type="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$current"
  case "$bump_type" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *) echo "Geçersiz bump tipi: $bump_type" >&2; exit 1 ;;
  esac
}

# package.json'daki "version" satırını günceller (sed kullanmadan — perl ile)
update_pkg_version() {
  local file="$1"
  local new_ver="$2"
  perl -i -pe 's/("version"\s*:\s*)"[^"]+"/$1"'"$new_ver"'"/' "$file"
}

# ── Kontroller ────────────────────────────────────────────────────────────────

[[ -z "$BUMP" ]] && usage
[[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]] && usage

cd "$REPO_ROOT"

# Working tree temiz mi?
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌  Git working tree temiz değil. Önce commit veya stash yap."
  git status --short
  exit 1
fi

# ── Mevcut versiyonu oku ───────────────────────────────────────────────────────

CURRENT_VERSION=$(node -e "console.log(require('$API_PKG').version)")
NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$BUMP")
TAG="v${NEW_VERSION}"
TODAY=$(date +%Y-%m-%d)

echo "📦  $CURRENT_VERSION → $NEW_VERSION ($BUMP bump)"

# ── package.json'ları güncelle ────────────────────────────────────────────────

update_pkg_version "$API_PKG" "$NEW_VERSION"
update_pkg_version "$GUI_PKG" "$NEW_VERSION"
echo "✓  packages/api/package.json"
echo "✓  packages/gui/package.json"

# ── CHANGELOG'u güncelle ──────────────────────────────────────────────────────

# Son tag'den bu yana commit'leri topla
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  GIT_LOG=$(git log "${LAST_TAG}..HEAD" --oneline --no-merges 2>/dev/null | sed 's/^/- /')
else
  GIT_LOG=$(git log --oneline --no-merges -20 2>/dev/null | sed 's/^/- /')
fi

[[ -z "$GIT_LOG" ]] && GIT_LOG="- (no commits since last release)"

# Yeni section başlığını oluştur
NEW_SECTION="## [$NEW_VERSION] — $TODAY

### Changed
$GIT_LOG"

# CHANGELOG'un ilk "## [" satırının önüne yeni section ekle
if grep -q "^## \[" "$CHANGELOG"; then
  perl -i -0pe "s/(^## \[)/$NEW_SECTION\n\n---\n\n\$1/m" "$CHANGELOG"
else
  printf "\n\n%s\n" "$NEW_SECTION" >> "$CHANGELOG"
fi

echo "✓  CHANGELOG.md güncellendi"

# ── Git commit + tag ──────────────────────────────────────────────────────────

git add "$API_PKG" "$GUI_PKG" "$CHANGELOG"
git commit -m "chore: release $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo ""
echo "✅  $TAG hazır!"
echo ""
echo "   Push etmek için:"
echo "     git push && git push --tags"
echo ""