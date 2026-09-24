# DevMoter Control vNext — repository audit

Audit baseline: `syr4wpywkk-collab/DevMoter-FAST` `main` at `711b08d` (2026-09-24). The audit is a code and repository review, not a claim of browser/device acceptance.

## Current architecture

- **Frontend:** Vite-built TypeScript modules and CSS in `src/`, served as a PWA/static client. The UI has separate surfaces for Codex, OpenCode, control center, workspace, terminal, settings, and integrations; there is no unified project dashboard or cross-OS host capability client yet.
- **Backend:** Node.js ESM HTTP server in `server.mjs`, with capability-specific modules under `server/`. It proxies or launches local OpenCode/Codex/provider tools and uses server-resolved project IDs for privileged workspace operations.
- **Authentication and Origin:** single-user Basic authentication plus optional external owner sessions; mutations pass exact same-origin checks. Optional WebAuthn passkeys add a host/origin-scoped gate. This is not multi-user authorization or device-bound per-resource identity.
- **Streaming:** OpenCode/Codex event streams and a terminal NDJSON stream exist. Terminal creation uses `script` to allocate a PTY; terminal transport is HTTP/NDJSON plus POST input, not a bidirectional WebSocket. Resize and durable reattachment are absent.
- **Host registry:** `server/control-plane.mjs` stores remote host labels, HTTP(S) addresses, trust state, schedules, and event triggers. It does not implement an OS-neutral local Host runtime or per-capability negotiation.
- **GitHub and automation:** host `gh` integration, webhook HMAC verification, schedules, bounded autopilot, recipes, and control-plane events exist. Triggers still rely on existing authentication/approval flows.
- **Agents/providers:** Codex app-server and OpenCode integrations are established; API Chat supports configured providers. Provider capabilities are not represented by one adapter contract. Third-party desktop tools have fixed launch integrations, not unified agent sessions.
- **Files and attachments:** project-scoped file/workspace tools and local attachment storage exist. Paths are server-resolved and validated; attachments have bounds/cleanup. Files, terminal, and Git are not yet one mobile workflow.
- **Browser:** opt-in browser automation is restricted to a local preview of a registered project and a fresh temporary profile. There is no managed persistent Chromium controller or general computer-use path.
- **Installer/systemd:** `main` has the existing fast installer and systemd unit. Installer v2 detector/plan/execution work lives on separate stacked branches; draft PR #248 is based on Phase 2 and remains explicitly non-installing because no reviewed executor is configured. It is not part of `main`.
- **Secrets:** provider credentials are kept server-side and omitted from public provider responses, but the current provider store is not the encrypted, reference-based API Vault requested by vNext.
- **Tests/build:** Node's built-in test runner, integration/security regression tests, TypeScript typecheck, custom lint, and Vite build are present (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`).

## Linear issue map

“Partial” means a related implementation exists, but the requested outcome or security acceptance is not met. Statuses below are based on `main`, not separate draft branches.

| Issue | Audit status | Existing/reusable work and remaining gap |
|---|---|---|
| MAR-11 Windows installer | Partial | Existing Linux fast installer and systemd setup. Windows/WSL detection, managed distro, resume/rollback, and GUI installer are new. Installer v2 is separate and has no executor yet. |
| MAR-12 Mobile Terminal | Partial | PTY creation, project cwd, random session capability, bounded scrollback, input/output, and idle cleanup. Add-on in this branch bounds live PTYs and tests ownership; WebSocket/xterm/resize/mobile toolbar/rate limits/reconnect polish remain. |
| MAR-13 API Vault | Partial | Host-side provider config and redacted public provider metadata. No encrypted-at-rest store, `secret://` references, project binding, re-auth reveal, or secret broker. |
| MAR-14 Security model | Partial | Auth, exact-origin mutation gate, optional passkeys, operation dedupe, agent/workspace policies, local-preview browser isolation. No unified action permission model or device/resource ownership model across future Host/Terminal/Secrets/Browser APIs. |
| MAR-15 Persistent terminal | Partial | Running process can survive client disconnect while server stays up. In-memory sessions do not survive server restart; no names, durable reattach token policy, or TTL metadata. |
| MAR-16 Linux Control | Partial | Control center, integrations, service/system feature modules. No full process/service/log/port/system monitor dashboard contract. |
| MAR-17 Workspace integration | Partial | Project files, terminal, Git/GitHub components exist separately. No single project-aware Files ↔ Terminal ↔ Git flow/mobile diff review. |
| MAR-18 Project Dashboard | New | Project state is available across existing endpoints but no unified dashboard aggregates it. |
| MAR-19 Agent Hub | Partial | Codex/OpenCode plus provider chat and some fixed CLI launchers. Missing shared `AgentProvider` capability/session contract. |
| MAR-20 AI approval loop | Partial | Reviewed changes, approval surfaces, logs/events, and workflow repair exist. Terminal error selection to agent proposal/diff/apply/verify is not a unified flow. |
| MAR-21 Host abstraction | Partial | Remote host registry can add/check host URLs. No OS-native capability protocol or Linux/macOS/Windows WSL implementations. |
| MAR-22 macOS installer | New | No native installer/permissions workflow. |
| MAR-23 Preview/Browser Controller | Partial | Narrow local preview browser automation with temporary profile. No automatic port discovery, persistent managed Chromium, or full preview controller. |
| MAR-24 Computer Use | New | Current browser feature is explicit local inspection, not proposal/approval/execution with audit policy. |
| MAR-25 Notifications/events | Partial | GitHub webhooks, automation events, and lifecycle records exist. No unified mobile push/deep-link notifications. |
| MAR-26 Microsoft 365 Copilot | New | No official provider adapter; research must remain on documented Microsoft paths. |
| MAR-27 Naming migration | New | Internal `devmoter-fast` package/service/repository identifiers remain. No collision/migration research recorded in repo. |

## Dependency and implementation order

1. Complete the cross-cutting MAR-14 threat model and enforceable policy boundaries.
2. Stabilize MAR-12 terminal resource/ownership foundation; then implement MAR-15 persistence.
3. Define MAR-21 Host protocol before OS control panels, vault, and installer integrations.
4. Implement MAR-13 secret storage and redaction before passing provider credentials into more agents or tools.
5. Build MAR-11 Windows work in its own stacked, reviewable installer PRs; do not merge the draft executor as if installation were complete.
6. Add dashboard/workspace/agent integrations, then isolated browser and approved computer-use work.

## Immediate security observations

- App authentication and network membership are separate. A host registry's “trusted” state is not authorization for remote shell access.
- Terminal uses a strong random per-session capability in addition to app authentication; that capability is bearer material and currently is not device-bound or replay-revocable.
- PTY count was unbounded at this baseline. This branch adds a server-side cap of four live sessions and regression coverage for concurrent creates and capability ownership.
- The application remains single-user: authenticated clients inherit the effective power of configured local agents and host tools. Do not expose the service as a hostile multi-tenant endpoint.
- Provider credentials are not yet an encrypted vault. Do not describe the current provider config as encrypted-at-rest secret storage.
- The browser automation boundary is narrow and should not be widened to personal profiles, arbitrary URLs, or remote networks without a separate threat review.
