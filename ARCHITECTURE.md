# Architecture

DevMoter FAST is a single-user, mobile-first control plane that keeps coding-agent processes and credentials on the host machine.

## High-level flow

```text
Browser / installed PWA
        |
        | HTTP(S) to DevMoter only
        v
DevMoter Node server (localhost by default)
   |                         |
   | HTTP proxy              | JSONL over stdio
   v                         v
OpenCode                   Codex app-server
   |                         |
   +-----------+-------------+
               |
        registered projects
        managed uploads/repos
```

Tailscale Serve may provide private HTTPS access to the DevMoter listener. It is deployment plumbing, not permission to expose the OpenCode port or Codex process directly.

## Browser to DevMoter

The frontend is built with Vite and served by `server.mjs`.

The browser talks to narrow DevMoter routes:

- `/api/opencode/*` for proxied OpenCode HTTP operations and events;
- `/api/codex/rpc` for allowlisted Codex app-server methods;
- `/api/codex/events` for Codex notifications/server requests;
- `/api/projects/*` for the local project registry and Markdown-only file access;
- `/api/github/*` for host-`gh` backed repository browsing/opening;
- `/api/health` for backend status.

Mutating requests carry a client operation ID where supported. The server keeps a bounded, expiring registry to suppress duplicate delivery.

## OpenCode boundary

DevMoter proxies HTTP to the configured localhost OpenCode server. OpenCode Basic Auth credentials stay in the Node process and are not returned to the browser.

Project selection is identity-based: the browser supplies a DevMoter Project ID, and the server resolves it to a registered path before setting the OpenCode directory header. Existing OpenCode sessions keep their own session context instead of being silently moved by a later project selection.

## Codex boundary

DevMoter starts `codex app-server --listen stdio://` and communicates over newline-delimited JSON on stdin/stdout.

The server allowlists Codex RPC method names before forwarding them. Codex approvals arrive as app-server requests and are surfaced to the browser; the browser response is validated before DevMoter writes the corresponding app-server result.

The Codex process uses the authentication already configured for the local Codex CLI. DevMoter does not put an OpenAI API key in frontend code.

## Projects and filesystem boundaries

Projects are registered host directories constrained to the user's home directory. The home directory itself is not a valid project.

The mobile file editor is intentionally narrow:

- only files inside a registered project are addressable;
- traversal and absolute-path escapes are rejected;
- symlink/real-path checks are used around project operations;
- browser write access is limited to Markdown files;
- Markdown reads/writes are size bounded;
- unregistering a project never deletes the directory.

GitHub repositories are cloned only under the DevMoter-managed repository root. Browser input is an owner/repository identity, not an arbitrary clone URL or destination.

## Upload lifecycle

Browser attachments are decoded by DevMoter and written under the configured upload directory with sanitized, generated names and restrictive file modes. Size limits are enforced before the file is handed to an agent.

Uploads are host-local temporary working data. Release work should keep cleanup/retention explicit rather than assuming the browser owns the file lifecycle.

## Streaming and reconnect

OpenCode events are normalized before the UI applies streamed text/reasoning state. Codex notifications are fanned out through DevMoter's event endpoint.

The frontend keeps one active event source per backend surface, reconciles persisted session/thread state after reconnect, and does not treat a transport retry as permission to replay a mutation.

Rendered transcript state may be bounded independently from the canonical backend session/thread history.

## Process interruption and failure

- OpenCode execution is interrupted through its HTTP API.
- Codex turns are interrupted through the allowlisted `turn/interrupt` RPC.
- CLI/app-server exits reject pending Codex requests and mark the bridge offline.
- Health and reconnect logic are backend-specific; one backend failing must not be treated as proof that the other backend is unavailable.

## Configuration boundaries

Machine-specific paths, passwords, tokens, and Tailnet names do not belong in source or documentation. Configuration is supplied through environment variables, the host CLI configuration, and DevMoter-owned state directories.
