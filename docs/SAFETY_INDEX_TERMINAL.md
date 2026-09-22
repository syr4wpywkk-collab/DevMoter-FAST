# Safety, project index, and terminal architecture

This document covers the features introduced for Issues #91–#100.

## Agent safety policy

DevMoter now has a small host-side safety policy layer shared by Codex, OpenCode, and future agent surfaces.

### Repeated-action detection

The loop detector keeps a bounded recent action window per run/session.

Environment controls:

```text
DEVMOTER_LOOP_THRESHOLD=3
DEVMOTER_LOOP_WINDOW=20
```

When the threshold is reached, DevMoter pauses remembered/automatic approval behavior and exposes the reason plus recent repeated actions. The user must explicitly continue before the run is resumed.

The detector is intentionally heuristic. It does not claim to prove that an agent is stuck.

### Pre-execution guard

Before Codex/OpenCode prompts are sent, DevMoter performs lightweight checks for:

- very ambiguous requests;
- broad architectural/design-risk wording;
- planned mutations outside an explicitly supplied scope;
- known repeat/loop risk.

The default behavior is conservative warnings, with scope expansion treated as a block. The guard never silently broadens a task.

### Remembered approvals

DevMoter can remember narrowly scoped approvals. Rules are stored host-side at:

```text
~/.config/opencode-pocket/remembered-approvals.json
```

A rule can scope by backend, tool/action, project, and session. Matching is exact for every populated field. Rules have an expiry and can be inspected/revoked from the DevMoter Tools → Safety panel.

High-risk command approvals are never remembered.

### High-risk command scan

The scanner detects several obviously dangerous shell patterns such as destructive Git cleanup/reset, raw block-device writes, filesystem formatting, broad forced deletion, forced pushes, and privileged commands.

The scanner:

- shows the exact command;
- explains which patterns matched;
- is advisory only;
- never replaces the normal approval boundary.

## Context compaction policy

`server/safety.mjs` includes a compaction policy for long-running agent context.

It preserves:

- system messages and project rules;
- active plans;
- unresolved approvals;
- recent tool state;
- the most recent conversational/tool history.

Every compaction result includes a visible `context.compacted` event with kept/dropped counts.

The compactor accepts a `summarize` callback plus a `summarizerModel` label, so a dedicated summarizer model can be plugged in by an agent backend without changing the preservation policy. Without one, DevMoter uses a deterministic bounded summary.

The dedicated context-usage/manual-compaction UI remains tracked separately by #142.

## Host-local project map and full-text index

Each registered project can build a bounded local index through DevMoter Tools → Project Index.

Index files are stored under:

```text
~/.local/state/opencode-pocket/project-indexes/
```

They are never uploaded by this feature.

### Rebuild and incremental behavior

A rebuild walks supported text files under the registered project root.

On later rebuilds, entries are reused when both size and modification time are unchanged. Changed/new files are read again and the index file is atomically replaced.

Current hard bounds:

- up to 2,500 files;
- up to 256 KiB per file;
- up to 12 MiB of indexed source text;
- up to 5,000 lines retained per file.

### Default exclusions

DevMoter skips common vendor/build directories including:

- `.git`
- `node_modules`
- `dist`
- `build`
- `.next`
- `.venv`
- `vendor`
- `coverage`
- `target`

It also excludes common secret-bearing filenames such as `.env*`, private keys, certificate bundles, credential files, and names containing `secret`.

Users can add project-specific exclusions before rebuilding.

### Search and repository map

Search results contain:

- file path;
- line number;
- bounded snippet;
- simple relevance score.

The repository map exposes bounded directory/file structure plus lightweight language-agnostic symbol extraction for common function/class/type forms.

The index can be deleted at any time from the UI or via the project index API.

## Authenticated persistent project terminal

The terminal is disabled unless:

```text
DEVMOTER_AUTH_PASSWORD=<at least 12 characters>
```

is configured.

The browser sends this password only in an HTTP Basic Authorization header for terminal routes and keeps the encoded header in `sessionStorage`, not persistent `localStorage`.

### PTY and project scope

The browser sends a registered Project ID, never an arbitrary cwd.

The server resolves that Project ID through the existing project registry and launches the host shell through the Linux `script(1)` utility, which provides a real pseudo-terminal (PTY).

The shell therefore starts in the server-resolved registered project path.

### Session persistence and re-attach

Each terminal has:

- a stable random server-side session ID;
- a separate random capability token;
- a bounded output replay buffer;
- a long-lived server-side shell process.

Closing the tools panel, navigating within the app, or reloading the page does not automatically kill the shell. Re-attach verifies all of the following again:

1. DevMoter terminal password;
2. terminal capability token;
3. Project ID is still registered;
4. the registered project path still matches the path captured when the terminal was created.

The stream uses authenticated `fetch()` with NDJSON replay rather than `EventSource`, so credentials do not need to be placed in query parameters.

### Explicit close

The user must use **Kill session** to terminate a persistent terminal early. The server sends SIGTERM first and escalates to SIGKILL after a short grace period if necessary.

Idle terminal sessions are also bounded and eventually terminated.

### Mobile key row

The terminal tools panel includes touch-friendly:

- Esc
- Tab
- Ctrl modifier
- arrow keys
- Home / End
- Page Up / Page Down

Buttons have accessible labels and only capture input while used inside the terminal controls; they do not override normal browser navigation.

### xterm.js loading

The client lazily loads xterm.js and its fit addon when the terminal is opened. This avoids adding a new npm/runtime bundle dependency to the main application. If the module cannot load, DevMoter falls back to an output-only transcript rather than converting terminal input into another command API.

The terminal password and capability checks remain enforced server-side regardless of renderer availability.
