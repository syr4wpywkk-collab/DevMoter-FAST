# Developer workflows, extensions, MCP, ACP, Skills, and Rules

DevMoter FAST keeps developer automation explicit and bounded. Repository content is treated as untrusted input; commands that can change the machine are never discovered and executed merely because a repository contains a file.

## Trusted user settings

Developer workflow settings live in:

`~/.config/opencode-pocket/dev-workflows.json`

The file is written with user-only permissions when DevMoter updates it. Verification commands are trusted only when they are present in this user-owned settings file. DevMoter does **not** automatically execute `package.json` scripts, Makefiles, repository hooks, or extension manifests.

Example:

```json
{
  "version": 1,
  "review": {
    "policy": "warn",
    "model": "",
    "maxDiffBytes": 220000
  },
  "verification": {
    "commands": [
      {
        "name": "build",
        "command": "npm",
        "args": ["run", "build"],
        "timeoutMs": 120000
      },
      {
        "name": "tests",
        "command": "npm",
        "args": ["test"],
        "timeoutMs": 120000
      }
    ],
    "repair": {
      "enabled": false,
      "model": "",
      "maxTurns": 1,
      "deadlineMs": 180000
    }
  },
  "skills": {
    "user": []
  },
  "rules": {
    "user": []
  },
  "adapters": {
    "acp": {
      "enabled": false,
      "command": "",
      "args": [],
      "capabilities": []
    }
  }
}
```

Verification uses `execFile` with a binary plus an argument array; it does not invoke a shell. The repair loop is disabled by default and is bounded by both `maxTurns` and `deadlineMs`.

## Pull-request review and final review

The Developer workflows panel can run an independent AI reviewer over a GitHub pull-request diff or over the current local diff.

Review mode is read-only by construction. If the review thread asks Codex for command execution or file-change approval, DevMoter declines the request. Findings carry file/line information when possible and are matched against diff hunks. Posting a finding to GitHub is a separate button and requires an explicit user action.

The review policy is one of:

- `off` — no policy gate.
- `warn` — findings are visible but do not represent a hard gate.
- `block` — findings are displayed as blocked so the user can inspect them before proceeding.

DevMoter does not silently post review comments.

## CI and repair loop

For a pull request, DevMoter uses authenticated GitHub CLI access to read check status. The UI distinguishes pending, success, failure, unknown, and unavailable states. When requested, failed workflow logs are bounded before they are returned to the browser.

The verification repair loop always follows this sequence:

1. Run only configured trusted verification commands.
2. If all pass, stop.
3. If repair is enabled, give the bounded failure output to a repair agent.
4. Run the same trusted verification commands again.
5. Stop at success, `maxTurns`, or `deadlineMs`.

A final failure remains visible; the loop never continues forever.

## Extension manifest v1

A project may contain `devmoter.extension.json`.

Example:

```json
{
  "manifestVersion": 1,
  "name": "my-devmoter-extension",
  "version": "1.0.0",
  "description": "Project metadata for DevMoter",
  "capabilities": ["skills", "rules", "mcp"],
  "permissions": [],
  "declarations": {
    "skills": [],
    "rules": [],
    "mcp": []
  }
}
```

Recognized capability/declaration keys in manifest version 1 are:

`commands`, `skills`, `hooks`, `mcp`, `adapters`, `themes`, `rules`, `review`, and `verification`.

Unknown capabilities and declarations fail closed. A manifest is metadata only: discovery does not execute repository code or commands.

Breaking changes require a new `manifestVersion`. Version 1 parsers must reject unknown unsafe declaration surfaces instead of guessing.

## MCP server management

MCP servers can be managed from **Developer workflows → MCP servers** without editing configuration files manually.

Each server has:

- `global` or `project` scope.
- `stdio` or `http` transport.
- A command plus argument list for stdio, or an HTTP endpoint.
- An enabled/disabled state.
- Optional environment values.

Secret-looking environment keys such as tokens, passwords, credentials, and API keys are masked in API/UI responses. Editing a server without resubmitting its environment preserves the stored secrets.

Connection tests are intentionally conservative. HTTP configuration performs a bounded reachability request. stdio configuration checks that the configured executable exists; the test does not launch an arbitrary MCP process just to populate the settings screen.

## Structured MCP tool results

MCP/tool output shown in conversation history is normalized into bounded structured data with a collapsible raw fallback.

Rendering uses DOM `textContent`, not untrusted HTML. Large strings, deeply nested data, and high-entry-count objects are truncated. This prevents tool output from injecting scripts or producing an unbounded browser payload.

## AgentAdapter and optional ACP compatibility

Native adapters remain first class:

1. Codex app-server
2. OpenCode HTTP
3. Optional ACP

The adapter registry negotiates required capabilities and reports when a requested adapter falls back to another compatible adapter.

The optional ACP adapter uses the stable ACP v1 JSON-RPC-over-stdio lifecycle: `initialize`, `session/new`, `session/prompt`, and `session/cancel`. ACP is disabled by default. When enabled, the Developer workflows panel can probe the configured agent by launching it and completing the v1 initialization handshake.

DevMoter advertises no implicit terminal or filesystem client capability to an ACP agent. Unexpected agent-to-client requests are rejected unless DevMoter explicitly implements them.

Protocol reference: https://agentclientprotocol.com/

## Skills

User skills are stored in trusted DevMoter settings. Project skills are Markdown files under:

`.devmoter/skills/*.md`

Discovery only reads bounded Markdown; it never runs project code.

Every skill exposes its source, scope, trust state, path, and precedence. DevMoter also merges discoverable native Codex skills into the same inspection view.

Skills with a concrete file path can be explicitly enabled as either a **Project default** or for the **Current session**. Discovery alone never activates a skill. Enabled skills are passed to Codex as `type: "skill"` turn inputs, so the instructions do not need to be pasted into the user's chat message.

Conflict behavior is deterministic:

- DevMoter user skill: precedence 20, trusted.
- Native user skill: precedence 15.
- DevMoter project skill: precedence 10, untrusted.
- Other native/project skill: precedence 5 unless the native source declares a trusted user scope.
- If names collide case-insensitively, the higher-precedence skill wins.

## Rules

DevMoter recognizes these project rule sources:

- `DEVMOTER.rules.md`
- `.devmoter/rules.md`
- `AGENTS.md`

Project rules are bounded text and are always marked untrusted. User rules come from user-owned DevMoter settings and are trusted.

Precedence is explicit:

- Project rule: precedence 10.
- User rule: precedence 20.

The Developer workflows panel shows the effective rules together with source, scope, trust state, precedence, and a preview so users can inspect what will influence a run.

When a new Codex thread is created, the effective rules are supplied through `thread/start.developerInstructions`, keeping persistent Rules separate from ordinary user chat history. Repository-provided rule text is wrapped with an explicit untrusted-content warning before it is supplied to the agent.
