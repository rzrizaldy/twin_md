#!/usr/bin/env bash
# GitHub desktop release for twin.md.
#
# Usage:
#   npm run release
#
# This is intentionally GitHub-only. npm packages are not published by this
# project closeout flow.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required for the GitHub release." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
HEAD_SHA="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$BRANCH" != "main" ]]; then
  echo "release must run from main; current branch is ${BRANCH}" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "release requires a clean committed worktree." >&2
  exit 1
fi

git fetch origin main --tags

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "release requires local main to match origin/main." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "tag ${TAG} already exists locally." >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "tag ${TAG} already exists on origin." >&2
  exit 1
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release ${TAG} already exists." >&2
  exit 1
fi

echo "==> clean"
npm run clean

echo "==> build packages"
npm run build

echo "==> typecheck"
npm run typecheck

echo "==> validate pet assets"
npm run validate:pet-assets

echo "==> build landing"
npm run build:landing

echo "==> build desktop web"
npm run build:web -w @twin-md/desktop

echo "==> cargo check"
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

echo "==> build desktop bundle"
npm run build:desktop

BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/release/bundle/dmg"
mapfile -t DMGS < <(find "$BUNDLE_DIR" -maxdepth 1 -type f -name "twin_${VERSION}_*.dmg" | sort)

if [[ "${#DMGS[@]}" -eq 0 ]]; then
  echo "no DMG found for ${VERSION} under ${BUNDLE_DIR}" >&2
  exit 1
fi

ARTIFACT_DIR="$ROOT/output/releases/${TAG}"
mkdir -p "$ARTIFACT_DIR"

for dmg in "${DMGS[@]}"; do
  cp "$dmg" "$ARTIFACT_DIR/"
done

(
  cd "$ARTIFACT_DIR"
  shasum -a 256 *.dmg > SHA256SUMS.txt
)

NOTES="$(mktemp -t twin-md-release-notes-XXXXXX.md)"
cat > "$NOTES" <<EOF
## Summary
- Final desktop-first closeout release.
- Removes terminal watch and daemon surfaces so Twin does not keep CLI UI sessions alive.
- Makes GitHub Releases the supported public install path.
- Adds reproducible clean/release tooling and checksum output.

## Verification
- npm run clean
- npm run build
- npm run typecheck
- npm run validate:pet-assets
- npm run build:landing
- npm run build:web -w @twin-md/desktop
- cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
- npm run build:desktop
EOF

echo "==> create GitHub release ${TAG}"
gh release create "$TAG" \
  --target "$HEAD_SHA" \
  --title "twin.md ${VERSION}" \
  --notes-file "$NOTES" \
  "$ARTIFACT_DIR"/*.dmg \
  "$ARTIFACT_DIR/SHA256SUMS.txt"

rm -f "$NOTES"

echo "==> release created: ${TAG}"
