# DevMoter FAST — Fast Install

This is the shortest supported path from a clean Linux environment to a local DevMoter FAST instance.

> [!IMPORTANT]
> DevMoter FAST is alpha software. It is intended for a single-user private host and trusted/private network. Read [SECURITY.md](./SECURITY.md) before exposing it beyond localhost.

## 1. Prerequisites

Install and configure:

- Git
- Node.js 22 and npm
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

Make sure OpenCode and Codex are authenticated through their own supported login/configuration flows before starting DevMoter.

Optional:

- GitHub CLI (`gh`) for repository browsing
- Tailscale for private phone access

Quick preflight:

```bash
for cmd in git node npm python3 curl opencode codex; do
  command -v "$cmd" >/dev/null || echo "Missing: $cmd"
done
```

If that prints nothing, the required commands are available.

## 2. Download

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
```

When the repository is public, GitHub's **Code → Download ZIP** also works, but Git is recommended because updates are much easier.

## 3. Install dependencies

```bash
npm ci
```

## 4. Start DevMoter

```bash
bash scripts/start-pocket.sh
```

A successful startup ends with a message similar to:

```text
✅ OpenCode + Codex DevMoter ONLINE
```

The default local URL is:

```text
http://127.0.0.1:8787
```

## 5. Optional: private phone access

With Tailscale installed and both devices on the same tailnet:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the HTTPS Serve URL shown by Tailscale from your phone.

Do not use a public tunnel or Tailscale Funnel for the current alpha unless you have added an appropriate authentication and authorization layer.

## Updating later

```bash
cd DevMoter-FAST
git pull --ff-only
npm ci
bash scripts/start-pocket.sh
```

## If startup fails

Run:

```bash
npm run build
npm test
```

Then check:

```bash
cat ~/.config/opencode-pocket/opencode.log
cat ~/.config/opencode-pocket/pocket.log
```

Do not paste logs publicly without checking them for usernames, local paths, repository names, tokens, or other private information.

For the full setup and architecture notes, see [README.md](./README.md).
