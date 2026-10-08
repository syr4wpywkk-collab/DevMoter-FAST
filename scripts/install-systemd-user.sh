#!/usr/bin/env bash
set -Eeuo pipefail

# Installer v2 local-only service step. Never accept a unit path, command,
# executable, or shell fragment from the web Setup API.
MODE="install"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --start) MODE="start" ;;
  *)
    echo "Usage: bash scripts/install-systemd-user.sh [--check|--start]" >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "Only one mode is accepted." >&2
  exit 2
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$CONFIG_HOME/systemd/user"
UNIT_FILE="$UNIT_DIR/devmoter-fast.service"
TEMPLATE="$REPO/systemd/devmoter-fast.service.in"

# systemd unit values have special escaping and specifier semantics. Refuse
# unsupported repository paths instead of emitting an invalid or unsafe unit.
if [[ ! "$REPO" =~ ^/[A-Za-z0-9_./+-]+$ ]]; then
  echo "Repository path contains characters unsafe for the current systemd template." >&2
  exit 1
fi
if [[ "$CONFIG_HOME" != /* ]] || [[ -L "$CONFIG_HOME" ]] ||
   [[ -L "$CONFIG_HOME/systemd" ]] || [[ -L "$UNIT_DIR" ]]; then
  echo "Refusing a relative or symlinked systemd configuration directory." >&2
  exit 1
fi
if [[ -L "$UNIT_FILE" ]]; then
  echo "Refusing to replace a symlinked DevMoter service unit." >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required by the existing service installer." >&2; exit 1; }
if [[ "$MODE" != "check" ]]; then
  command -v systemctl >/dev/null 2>&1 || { echo "systemctl is unavailable; no service changes made." >&2; exit 1; }
fi

# Compare the whole rendered unit, refuse customized units, and write
# atomically with private permissions. The browser never supplies a path.
RESULT="$(python3 - "$MODE" "$TEMPLATE" "$UNIT_DIR" "$UNIT_FILE" "$REPO" <<'PY'
import os
from pathlib import Path
import stat
import sys
import tempfile

mode, template_arg, dir_arg, unit_arg, repo = sys.argv[1:]
template, unit_dir, unit = Path(template_arg), Path(dir_arg), Path(unit_arg)
banner = "# Managed by DevMoter FAST Installer v2 (edit outside the installer)\n"
legacy = template.read_text(encoding="utf-8").replace("@WORKDIR@", repo)
rendered = banner + legacy

if unit.is_symlink() or unit_dir.is_symlink() or unit_dir.parent.is_symlink():
    raise SystemExit("Refusing a symlinked service path.")

existing = None
if unit.exists():
    info = unit.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise SystemExit("Existing DevMoter service is not a regular user-owned file.")
    existing = unit.read_text(encoding="utf-8")
    if existing not in (legacy, rendered):
        raise SystemExit("Existing service has custom changes; refusing to overwrite.")

if mode == "check":
    print("installed" if existing in (legacy, rendered) else "missing")
    sys.exit(0 if existing is not None else 1)

if existing == rendered:
    print("unchanged")
    sys.exit(0)

unit_dir.mkdir(parents=True, exist_ok=True)
if unit_dir.is_symlink() or unit_dir.parent.is_symlink() or unit.is_symlink():
    raise SystemExit("Service directory changed to a symlink; refusing to write.")
fd, staged = tempfile.mkstemp(prefix=".devmoter-fast.", dir=unit_dir)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(rendered)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(staged, unit)
finally:
    if os.path.exists(staged):
        os.unlink(staged)
print("upgraded" if existing is not None else "installed")
PY
)"

if [[ "$MODE" == "check" ]]; then
  echo "DevMoter service: $RESULT"
  exit 0
fi

if [[ "$RESULT" != "unchanged" ]]; then
  systemctl --user daemon-reload
fi
echo "DevMoter service: $RESULT ($UNIT_FILE)"
if [[ "$MODE" == "start" ]]; then
  systemctl --user enable --now devmoter-fast.service
  # systemd active is only a process-level check; backend health is separate.
  ACTIVE=0
  for _ in $(seq 1 15); do
    if systemctl --user is-active --quiet devmoter-fast.service; then
      ACTIVE=1
      break
    fi
    sleep 1
  done
  if [[ "$ACTIVE" != 1 ]]; then
    echo "Service is not active. Inspect: journalctl --user -u devmoter-fast.service -n 100" >&2
    exit 1
  fi
  echo "Service process active; verify authenticated /api/health before marking setup ready."
else
  echo "Start explicitly: bash scripts/install-systemd-user.sh --start"
fi
echo "Status: systemctl --user status devmoter-fast.service --no-pager -l"
