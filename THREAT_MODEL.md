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

## DevMoter Control vNext: high-privilege action model

The vNext product adds remote terminal, secret references, OS control, and browser actions. The single-user alpha assumption above does **not** grant future agents implicit authority to these capabilities. Treat browser input, project content, agent output, and event payloads as untrusted even after the owner is authenticated.

### Principals and trust boundaries

| Principal/resource | Trust level | Required boundary |
|---|---|---|
| Host OS and DevMoter server process | Trusted for local policy and resource resolution; process compromise is out of scope | Keep privileged decisions and credentials on the host; minimize inherited authority. |
| Authenticated owner/device | Authenticated, not automatically authorized for every action | App auth plus optional device/passkey trust; sensitive actions may require fresh authentication. |
| Browser/PWA | Untrusted client | Exact Origin for mutations; never trust disabled controls or client-supplied paths, commands, capabilities, or policy results. |
| Agent/provider process | Separate principal with only explicitly delegated permissions | READ does not imply WRITE, EXECUTE, NETWORK, SECRET_USE, or DESTRUCTIVE. |
| Workspace files, terminal output, browser DOM, external events | Untrusted data | Never treat embedded instructions as policy or approval. Redact before logs/context. |
| Registered Project/Host/session | Server-owned resource identity | Resolve IDs server-side and verify current ownership/state on each request. |

### Action classes

| Permission | Meaning | Default |
|---|---|---|
| `READ` | Read registered project files or bounded metadata | Deny until a resource and scope are resolved. |
| `WRITE` | Modify a project file or create a reviewed patch | Ask/approval; validate path and detect drift. |
| `EXECUTE` | Start a terminal, command, agent tool, or service action | Deny unless the exact capability and resource are authorized. |
| `NETWORK` | Reach a remote endpoint or expose/forward a local port | Deny; apply destination and port policy. |
| `SECRET_USE` | Ask the host to inject/use a referenced secret | Deny; bind to provider + project + purpose and never return the value. |
| `DESTRUCTIVE` | Delete data, force-kill, publish, send, purchase, or change permissions | Fresh explicit confirmation; record an audit event. |

Capabilities are not transitive: an agent allowed `READ` cannot obtain terminal execution; a terminal session cannot reveal vault values; a browser session cannot reuse the user's personal profile; a scheduled task cannot weaken approval policy.

### Server enforcement sequence

Every high-privilege route must apply the relevant checks in this order, rejecting on missing/ambiguous state:

```text
AUTH → DEVICE/TRUST → ORIGIN → SESSION → CAPABILITY → RESOURCE OWNERSHIP → POLICY → ACTION → AUDIT
```

The checks are independent. Authentication establishes who is calling; a session capability establishes which resource action is being requested; resource ownership ties it to a server-resolved project/host/session; policy decides whether that action is allowed. No browser flag can replace any of them.

| Check | Existing coverage | vNext requirement |
|---|---|---|
| AUTH | Basic auth / external owner session at HTTP dispatch; optional passkey gate | Keep mandatory on all control APIs, including streams and future WebSocket upgrades. |
| DEVICE/TRUST | Terminal HTTP and workspace-control routes require an active paired-device token; Secret Vault management and Vault-backed API Chat operations also require an active paired-device credential. Terminal sessions bind to a device ID; revocation closes that device's sockets and managed PTYs. The remote host registry's trust label is not authorization. | Extend resource binding consistently to Agent, Browser, and Host APIs; reduce script-readable device-token exposure. |
| ORIGIN | Exact same-origin mutation checks; WebSocket ticket carries the validated Origin and is single-use | Keep handshake and reconnect checks covered as the terminal protocol evolves. |
| SESSION | Terminal ID plus 256-bit capability; persistent capability hash is rotated on explicit claim and TTL/revocation remove access | Extend revocation to provider/agent sessions; add fresh authentication for sensitive session transfer. |
| CAPABILITY | Narrow existing Codex RPC allowlist, agent modes, workspace policy; terminal has explicit entry header | Define operation-level permissions for the new Host protocol; unknown action means deny. |
| RESOURCE OWNERSHIP | Registered Project IDs, project-path revalidation, and terminal owner-device checks on HTTP and socket ticket upgrade | Apply owner + project + host checks to every Host capability and async completion. |
| POLICY | Workspace edits default to ask; browser preview is opt-in and loopback-only | Centralize policy evaluation for the six action classes; stricter deny/ask rule wins. |
| ACTION | Fixed local launchers and validated endpoint schemas | Use fixed executables/arguments and bounded resources; no browser-provided shell command, cwd, or secret value. |
| AUDIT | Automation/control-plane records selected lifecycle events | Record actor, capability, resource, decision, confirmation, and outcome; exclude tokens and secret values. |

### Current terminal boundary and device revocation

On the current MAR-12/MAR-15 stack, terminal HTTP operations require DevMoter application authentication and a valid trusted-device token. The server binds each new session to the trusted device ID, checks that identity on metadata, output, input, resize-ticket, and termination requests, and re-resolves the registered project path. Persistent-session claims are explicit transfers: they rotate the session capability and bind the new owner device. Persistent sessions created before device binding can be claimed by an active trusted device.

The browser receives the device token through the existing trust/pairing flow and sends it in an HTTP header; it remains in script-readable local storage, so same-origin XSS can steal it. This is device identity within the single-owner model, not a separate human-user authorization system. Revoking a trusted device closes its active terminal sockets, terminates its in-memory and managed tmux sessions, invalidates its pending socket tickets, and removes persistent metadata. If the metadata store is corrupt, revocation kills all sessions in the private DevMoter tmux namespace rather than leaving unidentifiable managed sessions running.

WebSocket attachment requires the existing single-use same-Origin ticket. The ticket is bound server-side to the session's owner device and that device is checked again at upgrade. Device revocation also closes already attached sockets. A stolen application password without a trusted device token cannot create or operate terminal sessions.

The live PTY count remains bounded to four per server process. The count is checked immediately before registration without an intervening await, so concurrent HTTP requests cannot pass the cap together. Spawn errors close the session and release the allowance. This cap does not provide per-session CPU/memory quotas or request rate limits.

### Threat-to-control tracking

| Threat | Current / next control | Remaining work |
|---|---|---|
| PTY hijack / unauthorized replay | App auth + trusted device identity + high-entropy session capability; explicit claim rotates and rebinds | Fresh authentication for takeover, bounded auth attempts, and rate limits. |
| WebSocket auth/Origin bypass | Single-use same-Origin ticket bound to session and active device; device revocation closes existing sockets | Add handshake/reconnect regression coverage for future protocol changes. |
| Arbitrary cwd / path traversal | Project ID resolves server-side; project path is revalidated at attach/use | Host protocol must keep all path resolution server-owned and symlink-aware. |
| Secret exfiltration / confused deputy | Encrypted Host vault, opaque references, paired-device-gated metadata/write/migration API, explicit user-confirmed migration of eligible file-backed providers, canonical preset endpoint and project checks before Host-side API Chat resolution, key sent only in upstream auth header, response redaction, mobile UI with no Reveal/Copy path, and no public HTTP resolve route | Migrate remaining env/custom provider credentials; extend the same server policy to Agent/Browser use; add fresh reauthentication for sensitive disclosure, audit coverage, and complete log/context redaction. A same-origin script compromise can still act with the paired-device token and read in-progress form inputs. |
| Agent privilege inheritance | Agent mode and workspace policy exist; external agent sandbox limits are documented | Separate action grants; no ambient Host/terminal/secrets inheritance; explicit escalation/approval path. |
| Browser profile/token theft | Local preview uses a fresh temporary browser profile and loopback targets only | Preserve isolation and add lifecycle/ownership/audit before persistent controller work. |
| Resource exhaustion | PTY live-session cap and bounded per-session scrollback | Add input/connection rate limits and OS-level CPU/memory/process budgets. |
| Unsafe automation / prompt injection | Event payloads are labeled untrusted; schedules preserve normal approval | Keep policy server-owned for every trigger and future Computer Use action. |
