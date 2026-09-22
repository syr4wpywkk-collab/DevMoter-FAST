# Maintainer learning guide

A maintainer should be able to explain these flows without relying on generated code commentary.

## Core walkthrough

1. **OpenCode prompt:** browser request → `/api/opencode/*` → server-side project resolution/auth headers → localhost OpenCode API → event stream → normalized UI state.
2. **Codex prompt:** browser → allowlisted `/api/codex/rpc` → `CodexBridge` → app-server stdin/stdout → notifications/events → UI.
3. **Mutation authorization:** DevMoter validates its own narrow request boundary; Codex/OpenCode remain responsible for the broader agent/tool permission model. Approval responses are explicit, validated messages.
4. **Uploads:** browser data URL → size/name validation → host upload directory → agent reference. The browser does not choose an arbitrary host path.
5. **Projects:** browser stores/selects a Project ID; DevMoter resolves the ID and enforces filesystem boundaries server-side.
6. **Crash/interruption:** pending Codex RPCs reject on process exit; OpenCode/Codex execution state is recovered independently; reconnect reconciles canonical state instead of replaying writes.
7. **Authentication:** verify the actual release branch. The private-network model is not a substitute for DevMoter-native authentication once #10 is enabled.

## Files to read first

- `server.mjs` — HTTP routes, proxying, project/file boundaries, uploads, duplicate suppression.
- `server/codex-bridge.mjs` — Codex process lifecycle and JSONL RPC.
- `server/security-helpers.mjs` — path/upload/RPC validation helpers.
- `server/github.mjs` — GitHub CLI boundary and managed clones.
- `src/opencode.ts` — OpenCode session/event UI.
- `src/codex.ts` — Codex thread/event UI.
- `src/execution-state.ts` — shared execution-state vocabulary.
- `test/` — executable examples of safety and compatibility expectations.

## Before changing a boundary

Answer these questions in the PR:

- What untrusted input crosses the boundary?
- Where is it validated?
- What credential or privileged process is reachable after validation?
- Can a retry duplicate a mutation?
- Can a path/symlink escape the intended root?
- What canonical state is used after reconnect?
- Which automated test covers the happy path and the failure path?
- What still requires a real device?

If you cannot answer one, treat that as part of the implementation work rather than a documentation afterthought.
