# Teacher / school deployment security checklist

DevMoter FAST is alpha software and currently assumes one trusted owner on one private host. This checklist is the minimum profile for a teacher or school demo.

## Required deployment profile

- Keep DevMoter bound to `127.0.0.1`.
- Do not expose port 8787, the OpenCode port, or Codex directly to the public Internet.
- For phone access, use private HTTPS such as Tailscale Serve. Do not use Tailscale Funnel.
- Use a unique generated DevMoter password. Do not reuse a school, Microsoft, Google, or GitHub password.
- Keep `~/.config/opencode-pocket` owner-only and never copy its secret files into the repository.
- Prefer a dedicated OS account/profile for the teacher demo.
- Register only the project folders needed for the demo. Do not register HOME itself.
- Start with non-sensitive repositories. Treat every authenticated DevMoter session as capable of controlling the configured coding agents.
- Keep Node.js, Codex CLI, OpenCode, GitHub CLI, Tailscale, and the OS updated.
- Run `npm run security:audit` before a demo or release and require the GitHub **Security Audit** workflow to pass.
- Review `SECURITY.md` and `THREAT_MODEL.md` after any change to authentication, remote access, terminal, secrets, automation, integrations, or filesystem boundaries.

## Recommended hardening

- Enable passkey gating where practical with `DEVMOTER_PASSKEY_REQUIRED=1`.
- Use GitHub owner login only after the local recovery credential has bound the intended owner.
- Revoke paired devices that are lost, replaced, or no longer used.
- Lock the API Secret Vault when it is not needed.
- Avoid placing school records, student personal data, production credentials, or other regulated data in demo projects.
- Keep browser extensions on the controller device to a minimum; same-origin script compromise is a high-impact threat.

## Before handing it to a teacher

1. Confirm `POCKET_HOST` is unset or exactly `127.0.0.1`.
2. Confirm remote access is private HTTPS only.
3. Confirm the Security Audit workflow is green on the exact commit being used.
4. Confirm there are no unexpected paired devices.
5. Confirm the registered project list contains only intended folders.
6. Confirm no API keys appear in browser storage, screenshots, logs, Issues, or repository files.
7. Confirm terminal, automation, reviewed-change, and host-integration features are enabled only if the demo actually needs them.

This checklist reduces risk; it does not turn the current alpha into a hostile multi-user or public-Internet service.
