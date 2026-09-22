#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${DEVMOTER_REPO_URL:-https://github.com/syr4wpywkk-collab/DevMoter-FAST.git}"
INSTALL_DIR="${DEVMOTER_INSTALL_DIR:-$HOME/.local/share/devmoter-fast}"
SCRIPT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing prerequisite: $1" >&2
    exit 1
  }
}

for cmd in git node npm python3 curl opencode codex; do need "$cmd"; done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ is required (found $(node --version))." >&2
  exit 1
fi

if [ -n "$SCRIPT_REPO" ] && [ -f "$SCRIPT_REPO/package.json" ] && [ -d "$SCRIPT_REPO/.git" ]; then
  INSTALL_DIR="$SCRIPT_REPO"
elif [ -d "$INSTALL_DIR/.git" ]; then
  :
elif [ -e "$INSTALL_DIR" ]; then
  echo "Install path exists but is not a Git checkout: $INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to modify a dirty checkout: $INSTALL_DIR" >&2
  exit 1
fi

npm ci
npm run build

echo
echo "DevMoter installed at: $INSTALL_DIR"
echo "Start now: bash $INSTALL_DIR/scripts/start-pocket.sh"
echo "Optional user service: bash $INSTALL_DIR/scripts/install-systemd-user.sh"
