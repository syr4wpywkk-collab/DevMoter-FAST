# DevMoter operations

## One-command installer

From an existing checkout:

```bash
bash scripts/install.sh
```

The installer verifies Git, Node.js 22+, npm, Python 3, curl, OpenCode, and Codex. It never runs `sudo` or silently escalates privileges.

The default install path for a fetched checkout is `~/.local/share/devmoter-fast`. Override it with `DEVMOTER_INSTALL_DIR`.

## Safe update

Updates are explicit:

```bash
bash scripts/update.sh
```

The updater refuses dirty worktrees, shows the current and target commits, creates a recovery branch, uses a fast-forward-only update, rebuilds/tests, and rolls the checkout back if validation fails. User config/state under `~/.config/opencode-pocket` is preserved.

## systemd --user

Install the user unit from the current checkout:

```bash
bash scripts/install-systemd-user.sh
systemctl --user enable --now devmoter-fast.service
```

No root service is required.

Useful commands:

```bash
systemctl --user start devmoter-fast.service
systemctl --user stop devmoter-fast.service
systemctl --user restart devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
journalctl --user -u devmoter-fast.service -f
```

The unit keeps DevMoter bound to `127.0.0.1` by default and runs OpenCode in the same user-service control group.
