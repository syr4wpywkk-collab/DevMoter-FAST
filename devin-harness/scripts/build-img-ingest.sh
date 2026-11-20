#!/usr/bin/env bash
# Build img-ingest as static binaries (CGO disabled) for linux/amd64 and linux/arm64.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${ROOT_DIR}/img-ingest"
BIN_DIR="${ROOT_DIR}/bin"

if ! command -v go >/dev/null 2>&1; then
  if [ -x "${HOME}/.local/go/bin/go" ]; then
    export PATH="${HOME}/.local/go/bin:${PATH}"
  else
    echo "go toolchain not found (expected on PATH or at ~/.local/go/bin/go)" >&2
    exit 1
  fi
fi

mkdir -p "${BIN_DIR}"

cd "${SRC_DIR}"

echo "building bin/img-ingest (linux/amd64)..."
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "${BIN_DIR}/img-ingest" .

echo "building bin/img-ingest-arm64 (linux/arm64)..."
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "${BIN_DIR}/img-ingest-arm64" .

echo "done:"
ls -lh "${BIN_DIR}/img-ingest" "${BIN_DIR}/img-ingest-arm64"
