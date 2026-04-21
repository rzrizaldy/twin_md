#!/usr/bin/env bash
# twin-md release script.
#
# Runs the whole workspace build, packs each package into a clean-room tmp dir
# to verify the published tarballs actually install, then npm publish -ws.
#
# Usage:
#   scripts/release.sh               # pack + verify only
#   scripts/release.sh --publish     # pack + verify + npm publish
#   scripts/release.sh --dry-run     # pack + verify + npm publish --dry-run

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="verify"
for arg in "$@"; do
  case "$arg" in
    --publish)
      MODE="publish"
      ;;
    --dry-run)
      MODE="dry-run"
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
  "packages/web"
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
  npm install --no-fund --no-audit ../twin-md-*.tgz
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
