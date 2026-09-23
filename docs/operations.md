# DevMoter operations

## One-command installer

From an existing checkout:

```bash
bash scripts/install.sh
```

The installer verifies Git, Node.js 22+, npm, Python 3, curl, OpenCode, and Codex. It never runs `sudo` or silently escalates privileges. Re-running it on a clean existing checkout is supported.

The default install path for a fetched checkout is `~/.local/share/devmoter-fast`. Override it with `DEVMOTER_INSTALL_DIR`.

## Safe update

Updates are explicit:

```bash
bash scripts/update.sh
```

The updater shows current/target package versions and commits, refuses dirty worktrees, creates a recovery branch, uses a fast-forward-only update, rebuilds/tests, and rolls the checkout back if validation fails. User config/state under `~/.config/opencode-pocket` is preserved.

## systemd --user

Install the user unit from the current checkout:

```bash
bash scripts/install-systemd-user.sh
systemctl --user enable --now devmoter-fast.service
```

No root service is required. The service provisions/reuses the same private OpenCode and DevMoter auth secrets as the normal launcher, and authenticated readiness checks are required before startup is considered successful.

Useful commands:

```bash
systemctl --user start devmoter-fast.service
systemctl --user stop devmoter-fast.service
systemctl --user restart devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
journalctl --user -u devmoter-fast.service -f
```

The unit keeps DevMoter bound to `127.0.0.1` by default and runs OpenCode in the same user-service control group.


## Release/readiness note

The manual launcher and `devmoter-fast.service` are intended to reach the same healthy runtime, but startup-parity testing remains an active reliability item. After installation or an update, verify both the service status and application health on the target host.

```bash
systemctl --user restart devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
curl -fsS http://127.0.0.1:8787/api/health
```

If the unit restart-loops, inspect `journalctl --user -u devmoter-fast.service` rather than falling back to or documenting an obsolete service name. The supported user unit is **`devmoter-fast.service`**.
