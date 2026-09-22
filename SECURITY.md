# Security Policy

DevMoter FAST is currently **alpha software**. Security review is ongoing, and the project should be deployed as a single-user private-host tool.

## Supported versions

Security fixes target the latest commit on `main` and the latest published release, when releases are available.

## Security boundary

DevMoter FAST is designed for a **single-user private host** and a **trusted/private network**.

Current protections include:

- DevMoter binds to `127.0.0.1` by default.
- DevMoter requires its own HTTP Basic login. `DEVMOTER_AUTH_PASSWORD` must be at least 16 characters or the server fails closed.
- The normal launcher generates a strong DevMoter password and stores it at `~/.config/opencode-pocket/devmoter-auth-password` with owner-only permissions.
- State-changing HTTP requests require an exact same-origin `Origin` header. This reduces cross-site request forgery risk for the browser-based control surface.
- API JSON responses use `Cache-Control: no-store`. OpenCode proxy responses are also forced to `no-store` except live SSE streams, which use `no-cache, no-transform`.
- Configured DevMoter/OpenCode passwords are redacted from JSON error output and top-level server error logs.
- OpenCode remains on localhost and its credentials stay server-side.
- Codex app-server is accessed over local stdio and Codex RPC methods are allowlisted.
- Project paths and Markdown writes remain constrained to registered project roots.

The DevMoter login is an **access boundary**, not a multi-user authorization model. After authentication, the client can control coding agents with the permissions granted to those agents.

## Recommended remote-access model

Keep DevMoter bound to localhost and put an HTTPS private-network proxy in front of it, such as Tailscale Serve:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Do not send the DevMoter Basic-auth password over cleartext HTTP on an untrusted network.

If a reverse proxy changes the externally visible scheme or host and its forwarded headers do not preserve that origin, set:

```text
DEVMOTER_PUBLIC_ORIGIN=https://your-device.your-tailnet.ts.net
```

The value must be the exact public origin used by the browser. Mutation requests with a missing or mismatched `Origin` are rejected.

Tailscale Funnel and other public-tunnel exposure are **not** the recommended deployment model for the current alpha. Do not expose the OpenCode port or Codex app-server directly.

## Credential handling

Do not place OpenCode, Codex, GitHub, provider, or DevMoter credentials in frontend source, browser storage, public Issues, screenshots, or logs.

The generated DevMoter password file and OpenCode password file are host-side secrets. Keep their filesystem permissions restricted and rotate them if they are disclosed.

## Host integration boundary

The Antigravity and Claude Code launchers are treated as privileged host integrations:

- integration endpoints are behind the same DevMoter authentication boundary as the rest of the UI/API;
- mutation routes additionally require exact same-origin browser requests;
- browser cross-site probes are rejected for integration status because status discovery invokes local executables;
- project working directories are resolved from the existing registered Project ID rather than accepting arbitrary paths from the browser;
- launch commands use fixed executable/argument arrays and do not invoke a shell;
- child processes do not inherit password, token, API-key, private-key, credential, or common process-injection environment variables;
- Antigravity Remote URLs are accepted only from the exact `https://antigravity.google.com` origin;
- QR handoff assets are bundled locally; displaying them does not contact a third-party QR service;
- DevMoter does not extract Claude/Antigravity OAuth sessions or turn consumer subscriptions into proxy APIs.

Enabling or hiding an integration in the UI is a presentation preference, **not** an authorization control. Treat anyone with valid DevMoter credentials as able to exercise the host integrations exposed by that installation.

## Known alpha limitations

- Authentication is single-user and does not provide per-user roles or fine-grained authorization.
- An authenticated user can trigger actions with the effective permissions of the configured coding agents and host integrations.
- Security-sensitive behavior can depend on upstream OpenCode, Codex, GitHub CLI, Node.js, reverse-proxy, and operating-system versions.
- The launcher is intended for a single-user development machine and stops older matching DevMoter/OpenCode processes before startup.

## Reporting a vulnerability

Please **do not post exploit details, credentials, tokens, private repository contents, or other sensitive material in a public Issue**.

Preferred reporting path:

1. Use GitHub's **Report a vulnerability / private vulnerability reporting** feature for this repository when available.
2. If private vulnerability reporting is unavailable, open a minimal public Issue asking for a private security contact channel. Do not include technical exploit details.

A useful private report includes the affected commit/version, environment, security impact, concise reproduction steps, and suggested mitigation if known. Remove secrets and personal data from logs or screenshots before sharing.

## Dependency and upstream security

Keep Node.js, OpenCode, Codex CLI, GitHub CLI, Tailscale/reverse-proxy components, and the operating system updated according to their respective security guidance. Upstream vulnerabilities should also be reported to the relevant project when appropriate.
