# Security coverage register — 2026-10-09

Status: **Alpha, defense-in-depth / not a release certification**.
This register distinguishes repository checks from verification on an actual
Chromebook/iPhone. A green CI result or static analyzer does not prove the
absence of vulnerabilities.

## Automated controls

| Surface | Enforced / checked | Evidence | Not established by this check |
| --- | --- | --- | --- |
| Dependency and package supply chain | `npm audit --audit-level=high`, `npm ci`, lockfile and dependency source policy | `.github/workflows/security-audit.yml`, `scripts/security-audit.mjs` | Upstream account compromise, all moderate/low CVEs |
| JS/TS browser, server, SDK, CLI | CodeQL `javascript-typescript` with `security-extended` | `.github/workflows/codeql.yml` | Exhaustive dataflow coverage or runtime configuration |
| GitHub Actions | CodeQL `actions`, read-only default repository token for CI/audit, immutable action pins | `.github/workflows/codeql.yml`, `ci.yml`, `security-audit.yml` | Compromised workflow administrator or runner image |
| Authentication and sessions | Regression suite for owner sessions, passkeys, OIDC, GitHub login, cookies, same-Origin requests | `test/auth*.test.mjs`, `test/oidc-auth.test.mjs`, `test/passkey-auth-v3.test.mjs`, `test/device-cookie-security.test.mjs` | Live provider configuration and browser-specific edge cases |
| WebSocket and terminal | Origin and session-ticket guards plus integration tests | `server/terminal-websocket.mjs`, `test/terminal-websocket.integration.test.mjs` | Host OS isolation / real-device reconnect behavior |
| GitHub/Projects/files | Path/root, symlink, Git state and origin guard regressions | `test/github*.test.mjs`, `test/project-index.test.mjs`, `test/security.test.mjs` | Chromebook+iPhone smoke (see `docs/GITHUB_WORKSPACE_DEVICE_SMOKE.md`) |
| Uploads/attachments | Pre-decode size guard and strict base64, SSRF checks, attachment tests | `server/security-helpers.mjs`, `server/attachments.mjs`, `test/security.test.mjs` | All malware payloads/content-type spoofing |
| Coding agents and automation | Allowlisted Codex RPC, reviewed operations, safety/permission regression tests | `test/safety-integration-regressions.test.mjs`, `test/session-control-security.test.mjs`, `test/remote-automation-security.test.mjs` | Sandboxing untrusted LLM/tool output |
| API Chat and provider vault | API routing and vault integration tests, encrypted/host-only secret storage contract | `test/multi-api-vault-integration.test.mjs`, `test/secret-vault-server.integration.test.mjs` | Third-party provider data retention/policies |
| Installer and services | Exact plan snapshot, vetted npm executors, filtered env; non-destructive systemd install tests | `test/setup-*.test.mjs`, `test/install-systemd-user.test.mjs` | Unimplemented auth/package broker, Tailscale automatic handoff |
| Static frontend/PWA | CSP, framing, MIME headers, browser regression tests | `server/security-headers.mjs`, `test/security-headers.test.mjs`, `test/pwa-backend.integration.test.mjs` | Complete prevention of XSS; device-local bearer material risk |

**Always run** the existing CI and Security Audit on each PR and main
update; CodeQL runs on PR, main and weekly schedule. The workflow definition
must actually complete successfully on GitHub before claiming CodeQL active.

## Fixes staged in this security pass

- Reject absolute/Windows/traversal/NUL Markdown paths before normalization.
- Cap upload data URL size before regex matching or base64 decoding.
- Pin CI/audit GitHub Actions to immutable SHAs, disable checkout credential
  persistence and limit the token's repository permission.
- Replace destructive `tailscale serve reset` documentation with a
  conflict-aware inspection and explicit private Serve setup.
- Add CodeQL scans for application code and workflow definitions.

## Open risks and manual gates

1. **High operational impact:** Browser-persisted device bearer material
   remains a known Alpha limitation (`SECURITY.md`). Treat any same-origin
   script compromise as able to act as the browser; reduce long-lived
   browser-readable credentials before expanding school/general availability.
2. **High operational impact:** An authenticated owner can control highly
   privileged local agents. The application is **not** a safe multi-user
   deployment or a hardened sandbox for untrusted project instructions.
3. **High operational impact:** Do not expose the service to the public
   internet. Validate Tailscale ACLs, HTTPS, login, logout and private Serve
   behavior on the actual host; never enable Funnel as an installer default.
4. **Release gate:** Verify Chromebook+iPhone with the smoke matrices and
   backup/recovery scenarios. Installer #240 and GitHub picker #13 must remain
   open until their respective acceptance criteria pass.
5. **Provider gate:** Real OIDC, GitHub CLI, OpenCode, Codex, Claude and
   Antigravity auth and version behavior depends on upstream changes and
   cannot be certified by fake executable tests.
6. **Code scanning gate:** Triage CodeQL results and npm audit alerts; no
   warning should be interpreted as permission to disable a security guard.

## Safe triage procedure

For a confirmed issue: record severity (P0/P1/P2), affected trust boundary,
reproduction using sanitized/disposable data, smallest mitigation, and a
regression test. Use private vulnerability reporting for actionable security
issues. Never paste tokens, passwords, private repository content, or
sensitive user data into public issues or CI artifacts.
