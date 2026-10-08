# Installer v2: local systemd user-service step

Issue: #240 · Scope: service unit installation and process-level activation only.

This step is deliberately **local-terminal only**. The browser Setup Wizard and
`/api/setup/execute` cannot send arbitrary service names, unit contents,
systemctl arguments, executable paths, or privileged commands.

## Commands

From the DevMoter FAST repository:

```bash
bash scripts/install-systemd-user.sh --check
bash scripts/install-systemd-user.sh
bash scripts/install-systemd-user.sh --start
```

- `--check` is read-only and exits nonzero when the service unit is absent or unsafe.
- The default installs an idempotent `devmoter-fast.service` unit without
  enabling or starting it.
- `--start` explicitly enables and starts that one systemd **user** service.
- Re-running preserves a matching managed unit; a generated legacy unit can
  be upgraded. Any customized or unrelated unit is **not** overwritten.
- Service files are written atomically and privately; symlinked paths are rejected.
- An unsupported repository path is rejected rather than rendered into
  an ambiguous systemd unit.
- No `sudo` is used and no password is collected.

The script requires Linux with a systemd user manager, Bash, Python 3, and
the existing repository unit template. Both Codex and OpenCode must be
installed and correctly configured for the current service entrypoint.

## Verification

```bash
systemctl --user status devmoter-fast.service --no-pager -l
journalctl --user -u devmoter-fast.service -n 100 --no-pager
```

A systemd `active` result **does not certify backend or HTTP health**. Do not
mark the Installer v2 setup as READY until authenticated `/api/health` confirms
the expected Codex and OpenCode backend state. Never paste the owner's
HTTP password into an issue, debug log, or browser setup form.

## Remaining for issue #240

This local step does **not** complete the Installer v2 epic. Still needed:

- A verified, reviewed authentication coordinator for upstream CLIs.
- Distribution-specific package support and safe OS-mediated privilege handoff.
- Server-owned persistent resume/progress state, not only transient plan snapshots.
- Setup Wizard integration of service activation and authenticated health.
- Conflict-safe private Tailscale Serve configuration, actual URL verification and QR.
- Chromebook/Crostini and iPhone device validation.

These deliberately remain blocked until the relevant behavior and security
conditions are verified. Neither a unit installation nor a green CI job
establishes an end-to-end Installer v2 release.
