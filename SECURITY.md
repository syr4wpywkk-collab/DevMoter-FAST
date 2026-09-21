# Security Policy

DevMoter FAST is currently **alpha software**. Security review is ongoing, and the project has known security limitations that matter when choosing how to run it.

## Supported versions

Security fixes are currently targeted at the latest commit on `main` and the latest published release, when releases are available. Older development snapshots may not receive fixes.

## Security boundary

DevMoter FAST is designed for a **single-user private host** and a **trusted/private network**.

Current expectations:

- the DevMoter server binds to `127.0.0.1` by default;
- OpenCode is expected to remain on localhost;
- Codex app-server is accessed over local stdio;
- upstream credentials stay on the host;
- DevMoter does **not** yet provide a complete independent authentication and authorization layer.

Do **not** expose the DevMoter HTTP server, OpenCode port, or agent backends directly to the public internet. Public tunnels and Tailscale Funnel are not recommended for the current alpha.

If you intentionally change `POCKET_HOST` away from localhost, you are changing the project's security boundary. Add an appropriate authentication and authorization layer before allowing untrusted clients to connect.

## Known alpha limitations

- Anyone who can reach an exposed DevMoter endpoint may be able to interact with coding agents using the permissions available to those agents.
- The launcher is intended for a single-user development machine and stops older matching DevMoter/OpenCode processes before startup. Review `scripts/start-pocket.sh` before using it on a shared host.
- Security-sensitive behavior can depend on upstream OpenCode, Codex, GitHub CLI, Node.js, and operating-system versions.

These are documented limitations, not a claim that every listed scenario is an exploitable vulnerability.

## Reporting a vulnerability

Please **do not post exploit details, credentials, tokens, private repository contents, or other sensitive material in a public Issue**.

Preferred reporting path:

1. Use GitHub's **Report a vulnerability / private vulnerability reporting** feature for this repository when it is available.
2. If private vulnerability reporting is unavailable, open a minimal public Issue asking for a private security contact channel. Do not include technical exploit details in that Issue.

A useful private report includes:

- the affected DevMoter FAST version or commit;
- operating system and relevant upstream versions;
- the security impact;
- concise reproduction steps;
- suggested mitigation, if known.

Please remove secrets and personal data from logs or screenshots before sharing them.

## Dependency and upstream security

DevMoter FAST depends on separately installed upstream tools. Keep Node.js, OpenCode, Codex CLI, GitHub CLI, and your operating system updated according to their respective security guidance.

Upstream product vulnerabilities should also be reported to the relevant upstream project when appropriate.
