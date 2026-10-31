#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_PORT="${OPENCODE_PORT:-49374}"
POCKET_PORT="${POCKET_PORT:-8787}"
POCKET_HOST="${POCKET_HOST:-127.0.0.1}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-pocket"
SECRET_FILE="$STATE_DIR/opencode-server-password"
AUTH_SECRET_FILE="$STATE_DIR/devmoter-auth-password"
OC_PIDFILE="$STATE_DIR/opencode.pid"
POCKET_PIDFILE="$STATE_DIR/pocket.pid"
OC_LOG="$STATE_DIR/opencode.log"
POCKET_LOG="$STATE_DIR/pocket.log"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [ ! -s "$SECRET_FILE" ]; then
  python3 - <<'PY' > "$SECRET_FILE"
import secrets
print(secrets.token_urlsafe(32))
PY
  chmod 600 "$SECRET_FILE"
fi

PASS="$(cat "$SECRET_FILE")"

AUTH_USER="${DEVMOTER_AUTH_USERNAME:-devmoter}"
if [ -n "${DEVMOTER_AUTH_PASSWORD:-}" ]; then
  AUTH_PASS="$DEVMOTER_AUTH_PASSWORD"
else
  if [ ! -s "$AUTH_SECRET_FILE" ]; then
    python3 - <<'PY' > "$AUTH_SECRET_FILE"
import secrets
print(secrets.token_urlsafe(32))
PY
    chmod 600 "$AUTH_SECRET_FILE"
  fi
  AUTH_PASS="$(cat "$AUTH_SECRET_FILE")"
fi

stop_pidfile() {
  local pidfile="$1"
  if [ ! -f "$pidfile" ]; then
    return
  fi

  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep .1
    done
  fi
  rm -f "$pidfile"
}

echo "🧹 old processes"
stop_pidfile "$POCKET_PIDFILE"
stop_pidfile "$OC_PIDFILE"

# Clean up older DevMoter launch styles from before this script existed.
pkill -f '[n]ode server.mjs' 2>/dev/null || true
pkill -f '[o]pencode serve.*49374' 2>/dev/null || true
sleep .5

cd "$REPO"

if [ ! -d node_modules ]; then
  echo "📦 npm install"
  npm install
fi

echo "🏗️ build"
npm run build

echo "🔥 OpenCode"
nohup env   OPENCODE_SERVER_USERNAME="opencode"   OPENCODE_SERVER_PASSWORD="$PASS"   opencode serve     --hostname 127.0.0.1     --port "$OC_PORT"   >"$OC_LOG" 2>&1 &

OC_PID=$!
echo "$OC_PID" > "$OC_PIDFILE"

OC_DIR="${OPENCODE_DIRECTORY:-$REPO}"

# Readiness is the same contract on OpenCode 1.x and 2.x: the server reports its
# version on its own version endpoint (2.x: /api/info, 1.x: /global/health),
# answers /api/location, and lists at least one enabled model on /api/model.
# (GET /api/provider is not a readiness signal: on 2.x it can be empty while
# the bundled OpenCode models are already usable.)
oc_get() {
  curl -fsS -u "opencode:$PASS" -H "x-opencode-directory: $OC_DIR" "http://127.0.0.1:$OC_PORT$1" 2>/dev/null || true
}

echo "⏳ OpenCode runtime warmup"
for i in $(seq 1 80); do
  if INFO_RAW="$(oc_get /api/info)" HEALTH_RAW="$(oc_get /global/health)" \
     LOCATION_RAW="$(oc_get /api/location)" MODELS_RAW="$(oc_get /api/model)" python3 - 2>/dev/null <<'PY'
import json, os

def parse(name):
    try:
        return json.loads(os.environ.get(name) or "")
    except ValueError:
        return None

version, api = None, None
for name, generation in (("INFO_RAW", "v2"), ("HEALTH_RAW", "v1")):
    payload = parse(name)
    if isinstance(payload, dict) and isinstance(payload.get("version"), str):
        version, api = payload["version"], generation
        break
assert version, "version endpoint not answering"
location = parse("LOCATION_RAW")
assert isinstance(location, dict) and location.get("directory"), "/api/location not ready"
models = parse("MODELS_RAW")
m = models.get("data") if isinstance(models, dict) else models
assert isinstance(m, list) and len(m) > 0, "no models yet"
print(f"✅ OpenCode {version} (API {api}) ready: {len(m)} models")
PY
  then
    break
  fi

  if [ "$i" -eq 80 ]; then
    echo "❌ OpenCode runtime failed to become ready (version endpoint, /api/location or /api/model)"
    tail -n 80 "$OC_LOG" || true
    exit 1
  fi
  sleep .25
done

echo "🔥 DevMoter"
nohup env   OPENCODE_URL="http://127.0.0.1:$OC_PORT"   OPENCODE_SERVER_USERNAME="opencode"   OPENCODE_SERVER_PASSWORD="$PASS"   OPENCODE_DIRECTORY="$OC_DIR"   DEVMOTER_AUTH_USERNAME="$AUTH_USER"   DEVMOTER_AUTH_PASSWORD="$AUTH_PASS"   POCKET_HOST="$POCKET_HOST"   POCKET_PORT="$POCKET_PORT"   CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"   CODEX_CWD="${CODEX_CWD:-$HOME}"   node server.mjs   >"$POCKET_LOG" 2>&1 &

POCKET_PID=$!
echo "$POCKET_PID" > "$POCKET_PIDFILE"

for i in $(seq 1 40); do
  RESULT="$(curl -fsS -u "$AUTH_USER:$AUTH_PASS" "http://127.0.0.1:$POCKET_PORT/api/health" 2>/dev/null || true)"
  if [ -n "$RESULT" ] && echo "$RESULT" | python3 -c '
import json, sys
data = json.load(sys.stdin)
assert data["backends"]["opencode"]["online"] is True
assert data["backends"]["codex"]["online"] is True
' 2>/dev/null; then
    echo
    echo "✅ OpenCode + Codex DevMoter ONLINE"
    echo "$RESULT"
    echo

    PROVIDERS="$(curl -fsS -u "$AUTH_USER:$AUTH_PASS" "http://127.0.0.1:$POCKET_PORT/api/opencode/pocket/providers" 2>/dev/null || true)"
    if [ -n "$PROVIDERS" ]; then
      echo "$PROVIDERS" | python3 -c '
import json, sys
data = json.load(sys.stdin)
providers = data.get("all", [])
model_count = sum(len((p.get("models") or {})) for p in providers)
print(f"🧠 OpenCode providers: {len(providers)}")
print(f"🤖 OpenCode models:    {model_count}")
if not providers or model_count == 0:
    raise SystemExit(2)
' || {
        echo "⚠️ DevMoterはOnlineだけど、OpenCodeのProvider/Model取得が空です（/api/opencode/pocket/providers）"
        echo "$PROVIDERS"
        exit 1
      }
    fi

    echo
    echo "🔐 DevMoter username: $AUTH_USER"
    if [ -z "${DEVMOTER_AUTH_PASSWORD:-}" ]; then
      echo "🔑 DevMoter password file: $AUTH_SECRET_FILE"
    fi
    echo
    if command -v tailscale >/dev/null 2>&1; then
      tailscale serve status || true
    fi
    exit 0
  fi

  if [ "$i" -eq 40 ]; then
    echo "❌ DevMoter failed"
    echo "$RESULT"
    tail -n 100 "$POCKET_LOG" || true
    exit 1
  fi
  sleep .25
done
