#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# A regular restart should not rebuild an identical frontend. Hash build
# inputs instead of trusting file mtimes or the Git commit (dirty edits count).
# The stamp lives in ignored dist/, never in the tracked working tree.
if [ ! -d node_modules ]; then
  echo "Dependencies are missing: run npm ci before starting DevMoter." >&2
  exit 1
fi

build_inputs=(
  src public vendor/genoffice
  index.html package.json package-lock.json
  tsconfig.json vite.config.ts
  scripts/build-office-engine.mjs scripts/build-id.mjs
  scripts/service-worker-cache.mjs
)
fingerprint="$(
  {
    for item in "${build_inputs[@]}"; do
      if [ -d "$item" ]; then
        find "$item" -type f -print0
      elif [ -f "$item" ]; then
        printf '%s\0' "$item"
      fi
    done
  } | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | cut -d ' ' -f 1
)"

stamp="dist/.devmoter-source-fingerprint"
if [ -f dist/index.html ] && [ -f dist/build.json ] && [ -f "$stamp" ] &&
   [ "$(cat "$stamp")" = "$fingerprint" ]; then
  echo "✅ Frontend unchanged — skipping build"
  exit 0
fi

echo "🏗️ Build inputs changed (or dist is missing) — building"
npm run build
if [ ! -f dist/index.html ] || [ ! -f dist/build.json ]; then
  echo "Build finished without expected dist artifacts." >&2
  exit 1
fi
printf '%s\n' "$fingerprint" > "$stamp.tmp"
mv -f "$stamp.tmp" "$stamp"
echo "✅ Build ready"
