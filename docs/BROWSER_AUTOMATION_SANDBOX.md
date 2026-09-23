# Browser automation and OS sandbox

DevMoter's browser automation is an **opt-in local testing tool**, not a general-purpose browser remote control feature.

## Browser automation

Enable it explicitly:

```bash
DEVMOTER_BROWSER_AUTOMATION=1
```

The initial browser tool intentionally has a narrow boundary:

- it can open only the loopback live-preview target that the user already started for a registered DevMoter Project;
- arbitrary public URLs, private intranet pages, browser tabs, and the user's normal Chrome/Chromium profile are not accepted as targets;
- every run uses a fresh temporary browser profile;
- the personal browser profile, cookies, saved passwords, extensions, and logged-in web sessions are not mounted into the browser process;
- the UI always exposes the browser as an active capability with explicit **Start**, **Inspect DOM**, and **Stop** actions;
- DOM inspection output is bounded before it is returned to the client;
- the browser permission remains separate from filesystem, shell, network, credentials, and adapter permissions in the extension manifest.

A page loaded from the approved local preview can still reference remote resources. The temporary browser has no personal browser credentials, but developers should treat remote resources as network access and avoid placing secrets in test pages.

## OS sandbox policy

`DEVMOTER_SANDBOX` accepts:

- `off`: DevMoter does not apply the bubblewrap wrapper.
- `preferred` (default): DevMoter-owned agent tools use `bwrap` when it is available; if it is not installed, the tool can continue and the UI reports the downgrade.
- `required`: DevMoter-owned agent tools must run through `bwrap`; missing sandbox support fails closed.

The bwrap wrapper:

- binds the registered project as the tool workspace;
- mounts only explicitly granted extra directories;
- uses a private `/tmp`;
- unshares networking by default;
- enables network access only for tools whose function requires it, such as the local browser-preview inspector.

### External agent backends

Codex and OpenCode execute their own tools outside DevMoter's process boundary. DevMoter cannot truthfully claim that wrapping its own Node process also wraps every command those external backends may launch.

Therefore, when `DEVMOTER_SANDBOX=required`, DevMoter **fails closed** instead of silently downgrading:

- new Codex turns / steering are rejected;
- new OpenCode prompts and direct mutation routes are rejected;
- positive Codex command approvals are rejected;
- OpenCode `once` / `always` permission replies are rejected while `reject` remains available;
- queued/background DevMoter tasks targeting Codex or OpenCode are rejected before execution.

Use `preferred` when you want the external backends to keep using their own native security/sandbox model while still sandboxing DevMoter-owned tools where possible.

## Threat-model notes

The browser tool is deliberately not allowed to attach to a user's authenticated browser, reuse a personal profile, or browse arbitrary private pages. Expanding beyond the approved local-preview boundary requires a separate security design covering credential delegation, private-network access, download handling, navigation policy, and auditability.
