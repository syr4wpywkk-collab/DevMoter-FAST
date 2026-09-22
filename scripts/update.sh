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
git fetch --prune origin
TARGET="$(git rev-parse "$TARGET_REF")"

echo "Current: $CURRENT"
echo "Target:  $TARGET"

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
