# Architecture

DevMoter FAST is a **single-user, host-local coding-agent control plane** with a mobile-first browser surface.

## System map

```text
Browser / installed PWA
        │ authenticated HTTP(S)
        ▼
┌──────────────── DevMoter Node server ────────────────┐
│ auth · origin checks · project identities · routing  │
│                                                      │
│  OpenCode proxy   Codex bridge   API Chat            │
│       │               │            │                 │
│       ▼               ▼            ▼                 │
│  localhost HTTP   JSONL/stdio   provider HTTPS       │
│                                                      │
│  Projects · GitHub · Reviewed Changes · Automation   │
│  Attachments · Host integrations · Device controls  │
└────────────────────────┬─────────────────────────────┘
                         ▼
              registered host resources
```

Tailscale Serve can provide private HTTPS transport to the DevMoter listener. It does not change the application trust model or make agent backends safe to expose publicly.

## Browser boundary

The browser is untrusted input. It sends identities and bounded requests; the server resolves privileged resources.

Important route families include:
- `/api/opencode/*` — OpenCode proxy/events;
- `/api/codex/*` — Codex RPC, events and attachments;
- `/api/projects/*` — registered projects and bounded file operations;
- `/api/github/*` — host-`gh` repository operations;
- API Chat/provider routes;
- workflow/review, automation, system/device and integration routes;
- `/api/health` — runtime health.

State-changing browser requests cross authentication and same-origin checks. Operation IDs are used where supported to suppress accidental duplicate delivery.

## Agent boundaries

### OpenCode

OpenCode runs on localhost. DevMoter proxies its HTTP API and keeps Basic Auth credentials server-side. Browser project selection uses a DevMoter Project ID; the server resolves that ID before supplying directory context.

### Codex

DevMoter launches `codex app-server --listen stdio://` and speaks JSONL over stdin/stdout. Browser RPC names pass a deny-by-default allowlist before forwarding. Approvals/server requests are surfaced to the UI and their responses are validated before being returned to the app-server.

Model availability and supported reasoning effort are discovered from the installed Codex app-server. DevMoter should not hard-code availability that upstream does not advertise.

### API Chat

The experimental API Chat surface uses host-side provider configuration. Stored provider secrets are not returned to the browser after configuration. Requests are validated for provider/model/reasoning and bounded attachment content before outbound provider calls.

## Project and Git boundaries

A browser cannot select an arbitrary raw cwd for privileged operations. Registered Project IDs resolve to host paths inside the configured boundary.

The project/editor layer rejects traversal and escape paths, checks symlink/real-path boundaries where relevant, bounds file sizes, and intentionally restricts browser editing to Markdown.

GitHub repository operations use the authenticated host `gh` session and a managed repository root. Existing origins and worktree state are checked before reuse or branch operations.

The reviewed-changes workflow adds a second boundary: proposed content is reviewed, context drift is detected, applied content is revalidated before commit, and unrelated dirty changes can block commits.

## Attachments

Attachments are stored as host-local files with generated/sanitized identities and size/type limits instead of repeatedly transporting large base64 payloads through agent protocol messages. Retention and cleanup remain an explicit operational concern.

## Automation and host integrations

Automation/control-plane and desktop integrations are **experimental privileged surfaces**. Host integration launchers use fixed executable/argument arrays rather than browser-provided shell strings, resolve project context server-side, and filter dangerous environment inheritance.

Automation must remain bounded: a scheduler or event trigger is not permission to bypass project, authentication, approval, or host boundaries.

## Streaming, reconnect and failure

OpenCode events and Codex notifications are normalized for the UI. The frontend reconciles persisted session/thread state after reconnect and must not interpret a transport retry as permission to replay an ambiguous mutation.

One backend failing does not imply the other backend is unavailable. CLI/app-server exits reject pending work and move their surface into an offline/reconnect state.

## Trust summary

DevMoter protects the boundary **between a browser and privileged host tools**. It does not sandbox the coding agents themselves. Once an authenticated user authorizes an agent action, the underlying agent may have broader filesystem/shell permissions than the narrow browser editor.

See [THREAT_MODEL.md](./THREAT_MODEL.md) and [SECURITY.md](./SECURITY.md).
