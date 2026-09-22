#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_REF="${DEVMOTER_UPDATE_REF:-origin/main}"
cd "$REPO"

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to update a dirty checkout. Commit or stash your changes first." >&2
  exit 1
fi

CURRENT="$(git rev-parse HEAD)"
CURRENT_VERSION="$(python3 -c 'import json; print(json.load(open("package.json")).get("version","unknown"))')"
git fetch --prune origin
TARGET="$(git rev-parse "$TARGET_REF")"
TARGET_VERSION="$(git show "$TARGET:package.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version","unknown"))')"

echo "Current: $CURRENT_VERSION ($CURRENT)"
echo "Target:  $TARGET_VERSION ($TARGET)"

if [ "$CURRENT" = "$TARGET" ]; then
  echo "Already up to date."
  exit 0
fi

BACKUP="devmoter-backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP" "$CURRENT"
echo "Recovery branch: $BACKUP"

rollback() {
  echo "Update failed; restoring $CURRENT" >&2
  git reset --hard "$CURRENT" >/dev/null
  npm ci >/dev/null 2>&1 || true
  npm run build >/dev/null 2>&1 || true
}
trap rollback ERR

git merge --ff-only "$TARGET"
npm ci
npm run build
npm test

trap - ERR
echo "Updated successfully to $(git rev-parse HEAD)."
echo "User config/state under ~/.config/opencode-pocket was not modified."
