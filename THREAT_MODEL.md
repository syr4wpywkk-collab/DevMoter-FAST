# Threat model

This document describes the current DevMoter FAST trust boundaries. It is **not** a claim that the project is safe for public-Internet or hostile multi-user deployment.

## Assets

DevMoter can reach valuable host resources:
- source repositories and local files;
- Codex/OpenCode/provider/GitHub credentials held by host tools;
- project identities and private repository metadata;
- approvals and agent execution state;
- uploaded attachments;
- Git branches/worktrees and reviewed changes;
- privileged host integrations and automation state.

## Deployment assumption

The supported model is a **single-user private host**. DevMoter binds to `127.0.0.1` by default and remote-phone access should use private HTTPS transport such as Tailscale Serve.

DevMoter-native authentication is an application access boundary, but it is not a multi-user role/authorization system. An authenticated client is assumed to represent the host owner.

## Trust boundaries

1. **Browser ↔ DevMoter** — all browser input is untrusted: JSON, IDs, filenames, operation IDs, model/RPC names and UI state.
2. **DevMoter ↔ OpenCode** — privileged localhost agent runtime; credentials stay server-side.
3. **DevMoter ↔ Codex app-server** — privileged local process reached over stdio; browser RPC is allowlisted.
4. **DevMoter ↔ provider APIs** — API Chat sends validated requests using host-side credentials.
5. **DevMoter ↔ filesystem/Git** — Project IDs resolve server-side; paths, symlinks, drift and dirty state require validation.
6. **DevMoter ↔ GitHub CLI** — the host `gh` session is privileged; the browser cannot choose arbitrary executables or clone destinations.
7. **DevMoter ↔ host integrations** — installed CLIs and desktop launch targets are trusted local software but remain privileged.
8. **Automation/event boundary** — a trigger is data, not blanket authority; schedules/events must not bypass existing boundaries.

## Attacker models

### Reachable network peer

A peer that can obtain valid DevMoter credentials can exercise powerful host capabilities. Keep the listener private, use HTTPS for remote access, and treat credentials as host-control credentials.

### Same-tailnet peer

Tailnet membership is transport/network identity, not DevMoter authorization. Tailnet ACLs and DevMoter authentication are separate controls.

### Malicious web origin / CSRF

Mutation endpoints require authentication and exact-origin validation. Reverse-proxy deployments must preserve/configure the externally visible origin correctly.

### XSS / compromised same-origin frontend

Script-readable browser state is sensitive. A same-origin script compromise can act as the authenticated browser and may access browser-stored device material. CSP, escaping, dependency hygiene and reducing long-lived script-readable secrets are defense-in-depth priorities.

### Hostile path, repository or filename

Reject traversal, absolute escapes, unsafe symlinks, arbitrary clone destinations and mismatched Git origins. Browser-supplied project identities must resolve through server-owned registration.

### Compromised project content / prompt injection

Repository text may contain malicious instructions. Filesystem restrictions do not sandbox the coding agent or make project content trustworthy. Agent permission/approval policy is a separate boundary.

### Compromised local executable

A malicious/replaced `codex`, `opencode`, `gh`, `claude`, `agy` or other trusted host executable is inside the host trust boundary. DevMoter cannot turn a compromised local tool into a safe one.

## Important controls

- localhost-first bind and private HTTPS deployment;
- DevMoter authentication + exact-origin mutation checks;
- server-side upstream credentials;
- Codex RPC allowlist;
- Project-ID → server-side path resolution;
- bounded Markdown editor;
- attachment size/type/name controls;
- managed GitHub clone root and origin verification;
- reviewed-change drift and dirty-tree checks;
- fixed-argument host launchers and filtered environment inheritance;
- bounded duplicate-mutation registry;
- no blind retry of ambiguous writes.

## Non-goals

DevMoter is not currently:
- a hostile multi-tenant SaaS isolation boundary;
- a sandbox for arbitrary untrusted code;
- a replacement for OS user permissions;
- a guarantee that an enabled coding agent stays inside the mobile editor's filesystem scope;
- a public relay service;
- authorization for mutually untrusted people sharing one host.

## Known/residual risks

- upstream protocol/CLI changes can invalidate assumptions;
- an authenticated browser controls powerful agent capabilities;
- coding agents may have broader filesystem/shell authority than DevMoter's browser editor;
- browser-stored device material increases impact of same-origin script compromise;
- attachments/logs require retention discipline;
- experimental automation and host integrations need continuing contract/device testing;
- mobile background/reconnect behavior remains browser-dependent.

Security changes should update this document whenever a trust boundary or deployment assumption changes.
