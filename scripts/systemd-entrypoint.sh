#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_PORT="${OPENCODE_PORT:-49374}"
POCKET_PORT="${POCKET_PORT:-8787}"
POCKET_HOST="${POCKET_HOST:-127.0.0.1}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket"
SECRET_FILE="$STATE_DIR/opencode-server-password"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [ ! -s "$SECRET_FILE" ]; then
  python3 - <<'PY' >"$SECRET_FILE"
import secrets
print(secrets.token_urlsafe(32))
PY
  chmod 600 "$SECRET_FILE"
fi

PASS="$(cat "$SECRET_FILE")"
OC_DIR="${OPENCODE_DIRECTORY:-$REPO}"

cd "$REPO"

env   OPENCODE_SERVER_USERNAME=opencode   OPENCODE_SERVER_PASSWORD="$PASS"   opencode serve --hostname 127.0.0.1 --port "$OC_PORT" &
OC_PID=$!

cleanup() {
  kill "$OC_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 80); do
  if curl -fsS -u "opencode:$PASS" -H "x-opencode-directory: $OC_DIR"     "http://127.0.0.1:$OC_PORT/api/location" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep .25
done

if [ "$READY" -ne 1 ]; then
  echo "OpenCode failed to become ready" >&2
  exit 1
fi

env   OPENCODE_URL="http://127.0.0.1:$OC_PORT"   OPENCODE_SERVER_USERNAME=opencode   OPENCODE_SERVER_PASSWORD="$PASS"   OPENCODE_DIRECTORY="$OC_DIR"   POCKET_HOST="$POCKET_HOST"   POCKET_PORT="$POCKET_PORT"   CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"   CODEX_CWD="${CODEX_CWD:-$HOME}"   node server.mjs
