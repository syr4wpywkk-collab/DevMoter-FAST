# DevMoter FAST — Fast Install

The shortest supported path from a clean Linux environment to a private local DevMoter instance.

> [!IMPORTANT]
> DevMoter FAST is Alpha software for a single-user private host. Read [SECURITY.md](./SECURITY.md) before enabling remote access.

## 1. Prerequisites

Required:
- Git
- Node.js 22 + npm
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

Optional:
- GitHub CLI (`gh`) for repository integration
- Tailscale for private phone access

Authenticate OpenCode/Codex using their supported upstream flows.

Preflight:

```bash
for cmd in git node npm python3 curl opencode codex; do
  command -v "$cmd" >/dev/null || echo "Missing: $cmd"
done
```

## 2. Clone and start

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

Open:

```text
http://127.0.0.1:8787
```

The launcher prepares/reuses private local authentication, builds the frontend, starts the localhost OpenCode runtime, starts DevMoter, and performs readiness checks. Codex app-server is launched locally over stdio when used.

## 3. Private phone access

With Tailscale installed on the host and phone:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the resulting HTTPS URL from the same tailnet. Public tunnels/Funnel are not the recommended Alpha deployment.

## Installer and updates

Idempotent installer:

```bash
bash scripts/install.sh
```

Explicit safe update:

```bash
bash scripts/update.sh
```

The updater refuses dirty worktrees, uses fast-forward-only updates, preserves DevMoter config/state, validates the update, and keeps a recovery path.

## Optional systemd user service

```bash
bash scripts/install-systemd-user.sh
systemctl --user enable --now devmoter-fast.service
systemctl --user status devmoter-fast.service --no-pager -l
```

Use **`devmoter-fast.service`**. See [docs/operations.md](./docs/operations.md) for restart/log/update operations.

> [!NOTE]
> Manual-launch and systemd readiness parity is part of the active reliability audit. Validate the service on your host before relying on unattended startup.

## Validate

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If startup fails:

```bash
journalctl --user -u devmoter-fast.service -n 100 --no-pager
cat ~/.config/opencode-pocket/opencode.log
cat ~/.config/opencode-pocket/pocket.log
```

Review logs before sharing them: local paths, repository names or other private information may appear.

For architecture and feature maturity, return to [README.md](./README.md).
