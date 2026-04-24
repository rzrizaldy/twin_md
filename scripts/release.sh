#!/usr/bin/env bash
# twin-md release script.
#
# Runs the whole workspace build, packs each package into a clean-room tmp dir
# to verify the published tarballs actually install, then npm publish -ws.
#
# Usage:
#   scripts/release.sh               # pack + verify only (npm)
#   scripts/release.sh --publish     # pack + verify + npm publish
#   scripts/release.sh --dry-run     # pack + verify + npm publish --dry-run
#   scripts/release.sh --tauri       # build Tauri desktop bundle + GitHub Release
#   scripts/release.sh --tauri --publish  # npm publish AND GitHub Release

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="verify"
TAURI_RELEASE=0
for arg in "$@"; do
  case "$arg" in
    --publish)
      MODE="publish"
      ;;
    --dry-run)
      MODE="dry-run"
      ;;
    --tauri)
      TAURI_RELEASE=1
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

echo "==> building all packages"
npm run build

echo "==> packing tarballs for clean-room verification"
TMP="$(mktemp -d -t twin-md-release-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PACKAGES=(
  "packages/core"
  "packages/mcp"
  "packages/cli"
)

for pkg in "${PACKAGES[@]}"; do
  ( cd "$pkg" && npm pack --pack-destination "$TMP" >/dev/null )
done

echo "==> clean-room install in $TMP"
(
  cd "$TMP"
  mkdir -p probe
  cd probe
  npm init -y >/dev/null
  npm install --no-fund --no-audit ../*.tgz
  node -e "require('twin-md/dist/bin.js')" 2>/dev/null || true
  ./node_modules/.bin/twin-md --version
  ./node_modules/.bin/twin-md --help | head -n 20
)

case "$MODE" in
  verify)
    echo "==> verify OK. tarballs live at $TMP"
    echo "    re-run with --publish to push to npm."
    trap - EXIT
    ;;
  dry-run)
    echo "==> npm publish --dry-run across workspaces"
    npm publish -ws --access public --dry-run
    ;;
  publish)
    echo "==> npm publish across workspaces"
    npm publish -ws --access public
    ;;
esac

# ── Tauri desktop bundle + GitHub Release ────────────────────────────────────
if [[ "$TAURI_RELEASE" -eq 1 ]]; then
  echo ""
  echo "==> building Tauri desktop bundle"
  cd "$ROOT/apps/desktop"
  npm run build

  # Detect version from tauri.conf.json
  VERSION=$(node -e "const c=require('./src-tauri/tauri.conf.json'); console.log(c.version)")
  TAG="desktop-v${VERSION}"

  echo "==> tauri version: $VERSION  (tag: $TAG)"

  # Collect bundle artifacts (macOS produces .dmg + .app.tar.gz)
  BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/release/bundle"
  ARTIFACTS=()
  while IFS= read -r -d '' f; do
    ARTIFACTS+=("$f")
  done < <(find "$BUNDLE_DIR" \
    \( -name "*.dmg" -o -name "*.app.tar.gz" -o -name "*.AppImage" \
       -o -name "*.deb" -o -name "*.msi" -o -name "*.nsis.exe" \) \
    -print0 2>/dev/null)

  if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
    echo "no bundle artifacts found under $BUNDLE_DIR — did the build succeed?" >&2
    exit 1
  fi

  echo "==> artifacts to upload:"
  for a in "${ARTIFACTS[@]}"; do echo "    $a"; done

  if command -v gh &>/dev/null; then
    echo "==> creating GitHub release $TAG"
    gh release create "$TAG" \
      --title "twin desktop $VERSION" \
      --notes "Desktop companion bundle for twin.md $VERSION." \
      "${ARTIFACTS[@]}"
    echo "==> GitHub release created: $TAG"
  else
    echo "gh CLI not found — skipping GitHub release upload."
    echo "    artifacts are ready at: $BUNDLE_DIR"
  fi

  cd "$ROOT"
fi
