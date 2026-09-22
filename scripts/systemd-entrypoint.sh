#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_PORT="${OPENCODE_PORT:-49374}"
POCKET_PORT="${POCKET_PORT:-8787}"
POCKET_HOST="${POCKET_HOST:-127.0.0.1}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket"
OC_SECRET_FILE="$STATE_DIR/opencode-server-password"
AUTH_SECRET_FILE="$STATE_DIR/devmoter-auth-password"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

ensure_secret() {
  local file="$1"
  if [ ! -s "$file" ]; then
    python3 - <<'PY' >"$file"
import secrets
print(secrets.token_urlsafe(32))
PY
    chmod 600 "$file"
  fi
}

ensure_secret "$OC_SECRET_FILE"
OC_PASS="$(cat "$OC_SECRET_FILE")"

AUTH_USER="${DEVMOTER_AUTH_USERNAME:-devmoter}"
if [ -n "${DEVMOTER_AUTH_PASSWORD:-}" ]; then
  AUTH_PASS="$DEVMOTER_AUTH_PASSWORD"
else
  ensure_secret "$AUTH_SECRET_FILE"
  AUTH_PASS="$(cat "$AUTH_SECRET_FILE")"
fi

if [ "${#AUTH_PASS}" -lt 16 ]; then
  echo "DEVMOTER_AUTH_PASSWORD must be at least 16 characters" >&2
  exit 1
fi

OC_DIR="${OPENCODE_DIRECTORY:-$REPO}"
cd "$REPO"

env   OPENCODE_SERVER_USERNAME=opencode   OPENCODE_SERVER_PASSWORD="$OC_PASS"   opencode serve --hostname 127.0.0.1 --port "$OC_PORT" &
OC_PID=$!
POCKET_PID=""

cleanup() {
  if [ -n "$POCKET_PID" ]; then kill "$POCKET_PID" 2>/dev/null || true; fi
  kill "$OC_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 80); do
  if curl -fsS -u "opencode:$OC_PASS" -H "x-opencode-directory: $OC_DIR"     "http://127.0.0.1:$OC_PORT/api/location" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep .25
done
if [ "$READY" -ne 1 ]; then
  echo "OpenCode failed to become ready" >&2
  exit 1
fi

env   OPENCODE_URL="http://127.0.0.1:$OC_PORT"   OPENCODE_SERVER_USERNAME=opencode   OPENCODE_SERVER_PASSWORD="$OC_PASS"   OPENCODE_DIRECTORY="$OC_DIR"   DEVMOTER_AUTH_USERNAME="$AUTH_USER"   DEVMOTER_AUTH_PASSWORD="$AUTH_PASS"   POCKET_HOST="$POCKET_HOST"   POCKET_PORT="$POCKET_PORT"   CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"   CODEX_CWD="${CODEX_CWD:-$HOME}"   node server.mjs &
POCKET_PID=$!

HEALTH_HOST="$POCKET_HOST"
if [ "$HEALTH_HOST" = "::1" ]; then HEALTH_HOST="[::1]"; fi
READY=0
for _ in $(seq 1 80); do
  if curl -fsS -u "$AUTH_USER:$AUTH_PASS"     "http://$HEALTH_HOST:$POCKET_PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$POCKET_PID" 2>/dev/null; then break; fi
  sleep .25
done
if [ "$READY" -ne 1 ]; then
  echo "DevMoter failed to become ready" >&2
  exit 1
fi

echo "DevMoter FAST user service ready on $POCKET_HOST:$POCKET_PORT"
wait "$POCKET_PID"
