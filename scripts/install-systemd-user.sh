#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/devmoter-fast.service"
TEMPLATE="$REPO/systemd/devmoter-fast.service.in"

mkdir -p "$UNIT_DIR"
python3 - "$TEMPLATE" "$UNIT_FILE" "$REPO" <<'PY'
from pathlib import Path
import sys
template, output, repo = map(Path, sys.argv[1:])
content = template.read_text().replace("@WORKDIR@", str(repo))
output.write_text(content)
PY
chmod 600 "$UNIT_FILE"

systemctl --user daemon-reload
echo "Installed: $UNIT_FILE"
echo "Start:   systemctl --user start devmoter-fast.service"
echo "Enable:  systemctl --user enable --now devmoter-fast.service"
echo "Status:  systemctl --user status devmoter-fast.service --no-pager -l"
echo "Restart: systemctl --user restart devmoter-fast.service"
echo "Stop:    systemctl --user stop devmoter-fast.service"
echo "Logs:    journalctl --user -u devmoter-fast.service -f"
