#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_PORT="${OPENCODE_PORT:-49374}"
POCKET_PORT="${POCKET_PORT:-8787}"
POCKET_HOST="${POCKET_HOST:-127.0.0.1}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket"
OC_SECRET_FILE="$STATE_DIR/opencode-server-password"
AUTH_SECRET_FILE="$STATE_DIR/devmoter-auth-password"

# systemd --user does not necessarily inherit the interactive shell PATH.
# Keep this list conservative and user-local so common OpenCode/Codex installs
# remain discoverable after login, reboot, or service restart.
export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

resolve_binary() {
  local env_name="$1"
  local command_name="$2"
  local configured
  configured="$(printenv "$env_name" 2>/dev/null || true)"

  if [ -n "$configured" ]; then
    if [ ! -x "$configured" ]; then
      echo "$env_name points to a non-executable path: $configured" >&2
      return 1
    fi
    printf '%s\n' "$configured"
    return 0
  fi

  command -v "$command_name" 2>/dev/null || true
}

OPENCODE_BIN_RESOLVED="$(resolve_binary OPENCODE_BIN opencode)"
if [ -z "$OPENCODE_BIN_RESOLVED" ]; then
  echo "OpenCode executable not found." >&2
  echo "Checked PATH: $PATH" >&2
  echo "Set OPENCODE_BIN=/absolute/path/to/opencode if it is installed elsewhere." >&2
  exit 1
fi

CODEX_BIN_RESOLVED="$(resolve_binary CODEX_BIN codex)"
if [ -z "$CODEX_BIN_RESOLVED" ]; then
  echo "Codex executable not found." >&2
  echo "Checked PATH: $PATH" >&2
  echo "Set CODEX_BIN=/absolute/path/to/codex if it is installed elsewhere." >&2
  exit 1
fi

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

echo "Starting OpenCode: $OPENCODE_BIN_RESOLVED"
env \
  OPENCODE_SERVER_USERNAME=opencode \
  OPENCODE_SERVER_PASSWORD="$OC_PASS" \
  "$OPENCODE_BIN_RESOLVED" serve --hostname 127.0.0.1 --port "$OC_PORT" &
OC_PID=$!
POCKET_PID=""

cleanup() {
  if [ -n "$POCKET_PID" ]; then kill "$POCKET_PID" 2>/dev/null || true; fi
  kill "$OC_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

runtime_ready() {
  local providers_raw models_raw
  providers_raw="$(curl -fsS \
    -u "opencode:$OC_PASS" \
    -H "x-opencode-directory: $OC_DIR" \
    "http://127.0.0.1:$OC_PORT/api/provider" \
    2>/dev/null || true)"
  models_raw="$(curl -fsS \
    -u "opencode:$OC_PASS" \
    -H "x-opencode-directory: $OC_DIR" \
    "http://127.0.0.1:$OC_PORT/api/model" \
    2>/dev/null || true)"

  if [ -z "$providers_raw" ] || [ -z "$models_raw" ]; then
    return 1
  fi

  PROVIDERS_RAW="$providers_raw" MODELS_RAW="$models_raw" python3 - <<'PY' >/dev/null 2>&1
import json, os
providers = json.loads(os.environ["PROVIDERS_RAW"])
models = json.loads(os.environ["MODELS_RAW"])
p = providers.get("data", providers if isinstance(providers, list) else [])
m = models.get("data", models if isinstance(models, list) else [])
if not isinstance(p, list) or not p:
    raise SystemExit(1)
if not isinstance(m, list) or not m:
    raise SystemExit(1)
PY
}

READY=0
for _ in $(seq 1 120); do
  if ! kill -0 "$OC_PID" 2>/dev/null; then
    echo "OpenCode exited before its runtime became ready" >&2
    break
  fi
  if runtime_ready; then
    READY=1
    break
  fi
  sleep .25
done

if [ "$READY" -ne 1 ]; then
  echo "OpenCode failed to become ready (provider/model warmup incomplete)" >&2
  exit 1
fi

echo "OpenCode runtime ready"

env \
  OPENCODE_URL="http://127.0.0.1:$OC_PORT" \
  OPENCODE_SERVER_USERNAME=opencode \
  OPENCODE_SERVER_PASSWORD="$OC_PASS" \
  OPENCODE_DIRECTORY="$OC_DIR" \
  DEVMOTER_AUTH_USERNAME="$AUTH_USER" \
  DEVMOTER_AUTH_PASSWORD="$AUTH_PASS" \
  POCKET_HOST="$POCKET_HOST" \
  POCKET_PORT="$POCKET_PORT" \
  CODEX_BIN="$CODEX_BIN_RESOLVED" \
  CODEX_CWD="${CODEX_CWD:-$HOME}" \
  node server.mjs &
POCKET_PID=$!

HEALTH_HOST="$POCKET_HOST"
if [ "$HEALTH_HOST" = "::1" ]; then HEALTH_HOST="[::1]"; fi
READY=0
for _ in $(seq 1 120); do
  RESULT="$(curl -fsS -u "$AUTH_USER:$AUTH_PASS" \
    "http://$HEALTH_HOST:$POCKET_PORT/api/health" 2>/dev/null || true)"

  if [ -n "$RESULT" ] && echo "$RESULT" | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["backends"]["opencode"]["online"] is True
assert data["backends"]["codex"]["online"] is True
' 2>/dev/null; then
    READY=1
    break
  fi

  if ! kill -0 "$POCKET_PID" 2>/dev/null; then
    echo "DevMoter exited before health checks passed" >&2
    break
  fi
  sleep .25
done

if [ "$READY" -ne 1 ]; then
  echo "DevMoter failed to become ready with both OpenCode and Codex online" >&2
  exit 1
fi

echo "DevMoter FAST user service ready on $POCKET_HOST:$POCKET_PORT"
wait "$POCKET_PID"
