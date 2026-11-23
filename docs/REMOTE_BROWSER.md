# Remote browser

The remote browser shows a host-side Chromium session inside the DevMoter phone/PWA UI and lets the owner tap, scroll and type into it. A Codex Agent Run (or a manually configured MCP client) can drive the same session through `devmoter browser-mcp`, and the owner sees every agent action and can take control back at any time.

**Maturity: Experimental.** It is opt-in, limited to the project's approved loopback live preview, and has the unverified areas listed under [Known limits](#known-limits). General web browsing is not available.

## Requirements and enabling

| Requirement | Why |
|---|---|
| `DEVMOTER_BROWSER_AUTOMATION=1` in the DevMoter environment | Opt-in. Without it every `/api/browser*` session route returns `409 browser_disabled`. |
| A Chromium/Chrome binary: `DEVMOTER_BROWSER_BIN`, else `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable` on `PATH` | Probed with `--version`; otherwise `503 browser_unavailable`. |
| `bwrap` (bubblewrap) with user namespaces, and `DEVMOTER_SANDBOX` not `off` | Remote browser sessions always run under bubblewrap and refuse to start without it (`409 sandbox_required`). Chromium's own sandbox is never disabled. |
| A trusted (paired) device | Every `/api/browser` route requires an active trusted device. |
| A live preview started for the project (Files & preview) on an allowed loopback port | The browser may only load that preview origin (`409 preview_required`). |

Optional: `DEVMOTER_BROWSER_MAX_SESSIONS` (default `2`) caps concurrent sessions on the host.

After changing the environment, restart DevMoter. Check **System → Host** or Mission Control: the `browser` capability of `GET /api/host` reports `available` with features `preview-origin-only`, `ephemeral-profile`, `bubblewrap`, `screencast-websocket`, `driver-takeover`, `agent-mcp` when all requirements are met, and otherwise `unavailable` with one of `browser_automation_disabled`, `browser_binary_not_found`, `sandbox_disabled`, `sandbox_unavailable` (bubblewrap missing or unable to start a sandbox, e.g. user namespaces blocked). The capability is probed once when the server starts; installing Chromium or bubblewrap later needs a restart before it is reported.

## Using it from the phone

1. Select a project and start its live preview.
2. Open ☰ → **Browser** (also `?workspaceTab=browser`).
3. Tap **Start browser**. The preview page streams as JPEG frames.
4. Tap to click, drag or use the wheel to scroll (at the point under your finger), tap **Keyboard** to type (IME text is committed text, so Japanese input works). Back / Forward / Reload are in the top bar. The address is read-only.
5. The driver badge says who is driving. While an agent drives, **Take back control** makes you the driver immediately; **Let an agent drive** releases control.
6. **Stop browser** ends the session and deletes its profile.

A session belongs to the device that started it: other devices see that the browser is in use and cannot view, drive or stop it.

## Agent access

### Agent Runs (Codex)

An Agent Run requests browser access with `context.browser` set to `"read"` (screenshots, DOM) or `"act"` (also navigate, click, type, press, scroll, back, forward, reload). There is no UI switch for this yet; it is set in the `POST /api/agent-runs` / `POST /api/agent-fleets` spec. Access is never wider than the run's own capability policy (read-only runs get `read`) or its parent run's access. When granted, DevMoter:

- issues a `dmba_` agent token scoped to the project, the capabilities, the run and the requesting device, valid until the run deadline (at most 2 hours);
- writes it to a `0600` file under `~/.config/opencode-pocket/browser-agent-tokens/` and passes Codex a `mcp_servers.devmoter_browser` entry that starts `devmoter browser-mcp --url <loopback DevMoter> --token-file <file>`;
- revokes the token and deletes the file when the run ends.

OpenCode runs are not injected automatically.

### Manual MCP clients (Codex CLI, OpenCode, others)

`POST /api/browser/agent-tokens` with `{ "projectId", "access": "read" | "act", "ttlMinutes": 1-60 }` issues a token bound to your device (default 30 minutes) and returns ready-made `codex` and `opencode` MCP config snippets that read the token from `DEVMOTER_BROWSER_TOKEN`. `GET /api/browser/agent-tokens` lists your device's tokens and `DELETE /api/browser/agent-tokens/:id` revokes one.

### MCP tools

`browser_status`, `browser_open`, `browser_navigate`, `browser_click` (CSS selector or viewport point), `browser_type`, `browser_press`, `browser_scroll` (optional `x`/`y` point), `browser_back`, `browser_forward`, `browser_reload`, `browser_screenshot`, `browser_snapshot` (DOM text, labelled untrusted page content), `browser_take_control`, `browser_release_control`, `browser_close`.

The MCP process talks only to `/api/browser/agent*` on the loopback DevMoter address. Those routes accept only host-local requests (loopback peer and `Host`, no `Origin`, cookie or forwarding headers) with a valid `dmba_` bearer token.

### Policy

Agent actions are classed `browser.read` (screenshot, DOM) or `browser.act` (everything else that mutates). The token must grant the class; then workspace policy rules for tool `browser` and action `browser.read` / `browser.act` decide. With no matching rule both are allowed. A rule that says `ask` denies (`approval_unavailable`), because an agent cannot answer an approval. An explicit `deny` or `ask` is never replaced by the default, and a policy result of unknown shape or a policy error denies (`policy_denied`). Script evaluation and unknown action types are always denied. An agent cannot take control while the user is driving.

## Interfaces

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/browser?projectId=` | Capability, policy text and this device's session |
| POST | `/api/browser/sessions` | Start `{ projectId, viewport }` |
| GET / DELETE | `/api/browser/sessions/:id` | Read / stop |
| POST | `/api/browser/sessions/:id/actions` | One fixed-schema action with the current driver `generation` |
| POST | `/api/browser/sessions/:id/driver` | `{ "op": "acquire" }` or `{ "op": "release", "generation" }` |
| POST | `/api/browser/sessions/:id/ticket` | One-time WebSocket ticket |
| GET | `/api/browser/sessions/:id/screenshot` | JPEG (or `?format=png`) |
| GET / POST / DELETE | `/api/browser/agent-tokens[/:id]` | Manual agent tokens |
| WS | `/api/browser/sessions/:id/socket` | Subprotocols `devmoter-browser.v1` and `devmoter-ticket.<ticket>` |

The legacy `/api/advanced/browser*` Start / Inspect DOM / Stop tool still exists for compatibility and keeps its own boundary ([Browser automation sandbox](./BROWSER_AUTOMATION_SANDBOX.md)).

## Limits

| Limit | Value |
|---|---|
| Concurrent sessions per host | 2 (`DEVMOTER_BROWSER_MAX_SESSIONS`); one per project |
| Idle stop / maximum lifetime | 10 minutes / 2 hours |
| Viewers per session | 2 |
| Screencast | JPEG quality 60, at most 2 frames in flight, frame cap 2 MiB, viewer ACK timeout 10 s |
| WebSocket ticket | 20 s, single use |
| Client WebSocket messages | 16 KiB each, 60 per second (then close `4029`) |
| Typed text per action / DOM / screenshot | 2,000 characters / 512 KiB / 8 MiB |
| CDP command timeout | 15 s |
| Agent tokens | Run tokens up to 2 h, manual tokens up to 60 min, 64 live tokens, kept only as SHA-256 hashes in memory |

WebSocket close codes: `4001` session ended, `4003` ticket/device/Origin rejected, `4008` slow consumer, `4029` rate limited, `4400` bad message.

## Security boundary

- **Opt-in** with `DEVMOTER_BROWSER_AUTOMATION=1`; off by default.
- **Target**: only the loopback live preview the user started for the project. Chromium runs in an empty network namespace (`--unshare-net`): it has no route to the host, other loopback ports, private networks, the internet or DNS, and UDP (WebRTC) cannot leave. A relay inside the sandbox listens on the preview's loopback host:port and forwards over a `0600` Unix socket to the host, which connects only to that preview and only while the session is active and the same listening socket still owns the port. On top of that, Chromium sends all traffic to a dead proxy except the preview host:port, and CDP `Fetch` interception fails every request outside that origin, so other loopback ports, private networks, public sites and external CDN subresources are blocked. `navigate` rejects other origins and schemes (`403 navigation_blocked`).
- **CDP** runs over a private pipe (`--remote-debugging-pipe`) owned by the DevMoter process. No debugging port is opened, and agents never receive CDP access.
- **Profile**: each session uses a fresh `0700` profile directory under `~/.config/opencode-pocket/browser-profiles/` that is deleted on stop. The personal browser profile, cookies and passwords are never mounted.
- **Sandbox**: always bubblewrap, fail closed, with its own PID and network namespaces. The project directory is not mounted; only the ephemeral profile and the relay socket directory are writable.
- **Denied**: downloads, popups, JavaScript dialogs and permission prompts (camera, microphone, location, notifications, clipboard and others).
- **Owner binding**: a session is bound to exactly one principal, the starting device or (for host-local agent tokens without a device) that agent token. Sessions with no owner are never shared, and other devices get `403`. Revoking the device stops its sessions, closes their viewer sockets, cancels starts in progress and rejects requests whose body was still being read; revoking an agent token stops the sessions it started and drops its driver control. Changing or stopping the project's preview cancels starts in progress and stops its session; a session also stops acting if another process takes over the preview port.
- **Driver**: mutating actions need the current driver generation; the user's takeover always wins and invalidates older generations. Actions run one at a time per session (at most 8 waiting, then `429 browser_busy`), and the driver generation is checked again before every CDP input command, so an action queued before a takeover sends nothing after it.
- **Audit**: starts, stops, driver changes, agent token issue/revoke and every user (HTTP and WebSocket) and agent action are appended to `~/.config/opencode-pocket/browser-audit.jsonl` (`0600`). Typed text is recorded only as its length.

See [THREAT_MODEL.md](../THREAT_MODEL.md#remote-browser) for the residual risks.

## Operating procedures

**Enable on a host**

1. Install Chromium (or set `DEVMOTER_BROWSER_BIN` to a Chrome/Chromium binary) and `bubblewrap`.
2. Set `DEVMOTER_BROWSER_AUTOMATION=1` (for the systemd user service, in its environment) and restart DevMoter.
3. Confirm `browser` is `available` in System → Host. If it reports a reason, fix that requirement and restart.

**Stop everything quickly**

- Stop the session from the Browser tab, or `DELETE /api/browser/sessions/:id`.
- Stopping the project's live preview stops its browser session.
- Revoke a lost device in Settings → Devices: its sessions stop and its tickets and agent tokens are revoked.
- Revoke a manual agent token with `DELETE /api/browser/agent-tokens/:id`. Restarting DevMoter revokes every agent token.
- To disable the feature, remove `DEVMOTER_BROWSER_AUTOMATION` and restart.

**Review what happened**

Read `~/.config/opencode-pocket/browser-audit.jsonl`. Each line has `at`, `actor` (`user` or `agent`), `event`, ids (`projectId`, `sessionId`, `deviceId`, `tokenId`, `runId`), `capability`, `decision`, `ok`, `code` and, for WebSocket input, `transport: "websocket"`.

**Common errors**

| Code | Meaning | Fix |
|---|---|---|
| `browser_disabled` | Opt-in not set | Set `DEVMOTER_BROWSER_AUTOMATION=1` and restart |
| `browser_unavailable` | No Chromium/Chrome found | Install one or set `DEVMOTER_BROWSER_BIN` |
| `sandbox_required` | bubblewrap missing, disabled, or blocked | Install `bubblewrap`, allow user namespaces, do not set `DEVMOTER_SANDBOX=off` |
| `preview_required` | No approved loopback preview | Start the project's live preview |
| `session_limit` | Host session cap reached | Stop another session or raise `DEVMOTER_BROWSER_MAX_SESSIONS` |
| `session_owned_by_other_device` | Another device owns the project's session | Stop it from that device |
| `navigation_blocked` | URL outside the preview origin | Use a path on the preview |
| `approval_unavailable` / `policy_denied` / `capability_denied` | Agent action refused by policy or token | Adjust the workspace policy rule or issue a token with `act` |
| `agent_not_local` / `agent_token_invalid` | Agent request not host-local or token invalid/expired | Run the MCP on the host with a current token |

**Real-browser tests on a host**

CI has no usable Chromium for these tests, so `test/browser-session.chromium.test.mjs` and `e2e/remote-browser.test.mjs` skip there. To run them on a host with Chromium and bubblewrap:

```bash
DEVMOTER_TEST_CHROMIUM_BIN=/path/to/chrome \
DEVMOTER_TEST_CHROMIUM_REQUIRED=1 DEVMOTER_TEST_SANDBOX=required \
node --test test/browser-session.chromium.test.mjs e2e/remote-browser.test.mjs
```

Without `DEVMOTER_TEST_CHROMIUM_REQUIRED=1` the tests skip silently when Chromium or the sandbox cannot start.

## Known limits

- **Verified only on x86_64 with Chrome for Testing** under bubblewrap. ARM64 hosts and the Debian `chromium` package are unverified.
- **Network isolation is checked by a probe, not by every browser feature.** `test/browser-sandbox.real.test.mjs` runs the real sandbox command and confirms the project is not readable, other loopback ports, external TCP, DNS and UDP fail and the preview is reachable. Service Worker, iframe, redirect and `blob:`/`data:` handling inside Chromium were not exercised one by one; they cannot leave the network namespace except through the preview relay.
- **Real Codex / OpenCode launch of `devmoter browser-mcp` is unverified.** The MCP server is covered by JSON-RPC tests against a fake API, and Agent Run injection by unit tests; OpenCode has no automatic injection.
- **CI skips the real-Chromium tests** (no usable Chromium/user namespaces on the runners); only unit, integration and JSDOM UI tests run there.
- **iPhone / Android / iOS client** behaviour (soft keyboard, IME, gestures, reconnect after backgrounding) has not been checked on real devices.
- **No general web mode.** Only the project's loopback preview loads; external subresources are blocked, so preview pages that need a CDN render incomplete.
- **No approval path for agents**: a policy `ask` is a deny.
- The host capability is evaluated at server start only.
