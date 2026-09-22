# DevMoter FAST

**Your AI coding agents, anywhere. 📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

**English** | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

DevMoter FAST is a **mobile-first remote interface for Codex and OpenCode**. Run your coding agents on a Linux machine, then control them from your phone, tablet, or another browser through one lightweight web UI.

**Codex + OpenCode · PWA · English / 日本語 / 简体中文 · Open source**

The agents stay on the host machine; the browser talks to DevMoter instead of connecting to the agent processes directly.

> [!IMPORTANT]
> DevMoter FAST is an **experimental, unofficial community project**. It is not affiliated with or endorsed by OpenAI, OpenCode, or other upstream projects/providers referenced by the software.

> [!WARNING]
> DevMoter is designed for a **private-host / private-network** setup. It does not yet provide a complete independent user-authentication layer. Do not expose the DevMoter server, OpenCode port, or agent backends directly to the public internet.

## Start here

- ⚡ **Fast install:** [fastinstall.MD](./fastinstall.MD)
- 🔐 **Security policy & vulnerability reporting:** [SECURITY.md](./SECURITY.md)
- 📜 **Third-party licenses and interoperability notices:** [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

> [!CAUTION]
> **Alpha security notice:** security review is ongoing. DevMoter FAST has known security limitations and should only be used on a trusted/private network. If you discover a security issue, do not publish exploit details or secrets in a public Issue; follow [SECURITY.md](./SECURITY.md).

## Why DevMoter?

Coding agents are excellent on a desktop, but checking a long-running task from a phone is still awkward.

DevMoter is built for situations like:

- running your dev environment on Linux, Chromebook/Crostini, or a small always-on machine;
- checking agent progress without reopening a heavy desktop UI;
- approving actions or interrupting a run from your phone;
- switching between multiple coding-agent backends from one interface;
- keeping agent credentials and processes on your own host.

The goal is simple: **leave the coding machine running, carry the control surface in your pocket.**

## What works today

| Area | Current support |
| --- | --- |
| OpenCode | sessions, agents, provider/model selection, commands, skills, live events, reasoning/tool activity, permissions, questions, interrupt |
| Codex | thread history, new/resume/fork, model selection, reasoning effort, streaming, interrupt, approvals, attachments, plugins/MCP inventory |
| Projects | register/create projects, choose working directory, browse/read/write Markdown safely |
| GitHub projects | browse repositories through the host `gh` session, clone/open repositories into DevMoter-managed paths, branch/fetch safety checks |
| PWA | mobile-first UI, installable web app behavior, backend switching, online/offline health state |
| Languages | English, 日本語, 简体中文 with browser detection and a sidebar language switcher |
| Tests | Node test suite, coverage reporting, build checks, GitHub Actions CI |

DevMoter is still **alpha software**. Expect protocol changes, rough edges, and version-sensitive behavior.

## Quick start

### Requirements

Use a Linux environment with:

- Node.js and npm
- OpenCode CLI
- OpenAI Codex CLI
- Python 3
- `curl`

For GitHub repository browsing, install and authenticate GitHub CLI:

```bash
gh auth login
gh auth status
```

Your local coding-agent CLIs should already be authenticated/configured as required by their upstream tools.

### Upstream accounts and terms

DevMoter FAST does **not** provide, resell, share, or bundle accounts, subscriptions, API keys, login tokens, or other credentials for upstream services.

Each user must:

- use their own eligible account for each upstream service;
- authenticate through the upstream tool's supported login or authentication flow;
- comply with the applicable upstream terms, age requirements, usage policies, and account rules;
- avoid sharing account credentials or using another person's account through DevMoter.

DevMoter FAST is only a local interoperability layer. Availability of a backend in the UI does not grant a license or entitlement to use that upstream service.

Product and company names such as OpenAI, Codex, OpenCode, GitHub, and Tailscale are used only to describe compatibility or interoperability. Their trademarks and branding remain the property of their respective owners. DevMoter FAST is not affiliated with, sponsored by, or endorsed by those providers.

Tailscale is optional, but recommended for private phone access.

### 1. Clone

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
```


### 2. Start DevMoter

```bash
bash scripts/start-pocket.sh
```

The launcher currently:

1. installs npm dependencies when needed;
2. builds the web app;
3. creates and stores a local OpenCode server password;
4. starts OpenCode on localhost;
5. waits for the OpenCode runtime to become ready;
6. starts the DevMoter backend;
7. verifies backend health.

Default local endpoints:

```text
DevMoter:   http://127.0.0.1:8787
OpenCode: http://127.0.0.1:49374
```

Codex app-server is launched by DevMoter over stdio instead of being exposed as a public socket.

## Private phone access with Tailscale

DevMoter is intended to remain bound to localhost.

A simple private setup is:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the resulting HTTPS Tailscale Serve URL from a device on the same tailnet.

> [!CAUTION]
> Do **not** expose OpenCode's port, Codex app-server, or DevMoter itself through a public tunnel without adding an appropriate authentication and authorization layer.
>
> Tailscale Funnel is not the recommended deployment model for the current alpha.

## Architecture

```text
Phone / tablet / browser / PWA
              │
              │ HTTPS via Tailscale Serve (optional)
              ▼
      DevMoter FAST :8787
        127.0.0.1 by default
          │             │
          ▼             ▼
      OpenCode        Codex
       HTTP           stdio
      :49374       app-server
          │             │
          └──────┬──────┘
                 │
           local projects
```

The browser talks to DevMoter. DevMoter keeps the backend processes, local paths, and backend credentials on the host side.

## Backend surfaces

### OpenCode

The OpenCode surface is designed like a compact coding console.

Current capabilities include:

- session history and search;
- Plan / Build agent switching plus the full agent picker;
- provider and model selection;
- slash commands and skills inventory;
- live text and reasoning streams;
- tool and shell activity;
- permission requests and question flows;
- execution interrupt;
- token, cost, directory, agent, and model details.

DevMoter proxies the OpenCode API through `/api/opencode/*` and keeps the OpenCode Basic Auth secret on the server side.

### Codex

The Codex surface is chat-first.

Current capabilities include:

- thread history and search;
- new, resume, and fork thread flows;
- model selection and reasoning-effort controls;
- streamed responses;
- interrupt / stop;
- image and local-file attachments;
- command and file-change approvals;
- plugin inventory and MCP server status;
- project-aware working directories;
- Markdown editing from the Projects workspace.

DevMoter launches the local Codex app-server and communicates with it over JSONL/stdin/stdout. It uses the authentication already configured for the local Codex CLI; DevMoter does not place an OpenAI API key in the frontend.


## Projects workspace

DevMoter includes a lightweight project manager for mobile use.

You can:

- register an existing project directory;
- create a project directory;
- choose the active project;
- start agent work in that project's working directory;
- restore project context from existing threads/sessions where supported;
- browse Markdown files;
- quickly open files such as `AGENTS.md`, `HANDOFF.md`, and `README.md`;
- create and edit Markdown from the phone.

### File-safety boundaries

The editor is intentionally narrow:

- projects must stay inside the user's home directory;
- the home directory itself cannot be registered as a project;
- traversal outside registered projects is rejected;
- symlinked entries are not used to escape the project boundary;
- only `.md` files can be written through the mobile editor;
- Markdown writes are size-limited;
- unregistering a project never deletes the project directory.

## GitHub repository picker

DevMoter can use the host machine's authenticated GitHub CLI session to browse and open repositories.

The current design intentionally keeps GitHub credentials server-side:

- authenticate with `gh auth login`;
- DevMoter calls `gh` on the host;
- tokens are not returned to the browser or stored in browser `localStorage`;
- repositories are cloned under DevMoter-managed paths inside the user's home directory;
- existing clones are checked before reuse;
- dirty worktrees block operations that could overwrite local work;
- DevMoter does not silently reset, force-checkout, stash, rebase, or delete user changes.


## Security model

DevMoter is built around a **single-user private host** rather than a public multi-user SaaS model.

Current protections include:

- DevMoter binds to `127.0.0.1` by default;
- OpenCode binds to localhost;
- Codex app-server is reached over stdio;
- backend credentials stay server-side;
- Codex RPC methods are allowlisted;
- project paths are constrained to the user's home directory;
- Markdown writes are constrained to registered projects;
- uploaded files stay on the host;
- GitHub credentials stay in the host CLI session;

### Important limitation

DevMoter does **not** yet have a complete independent authentication system.

Anyone who can reach the DevMoter HTTP endpoint may be able to control coding agents with the permissions granted to those agents. Use Tailscale or another appropriately configured private network boundary.

## Testing

Run the test suite:

```bash
npm test
```

Run coverage:

```bash
npm run test:coverage
```

Build the frontend:

```bash
npm run build
```

Coverage reports are written under `coverage/`. GitHub Actions also runs the automated checks in CI.

The test suite is designed to exercise backend safety logic and CLI/bridge behavior without requiring real OpenCode or Codex sessions for every test.

## Configuration

Common environment variables:

```bash
OPENCODE_URL=http://127.0.0.1:49374
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=change-me

POCKET_PORT=8787
POCKET_HOST=127.0.0.1

CODEX_BIN=codex
# CODEX_CWD=/home/user/project


```

The normal launcher generates and stores its own OpenCode password, so manual password configuration is usually unnecessary.

Examples:

```bash
CODEX_BIN="$HOME/.local/bin/codex" bash scripts/start-pocket.sh
CODEX_CWD="$HOME/my-project" bash scripts/start-pocket.sh
OPENCODE_DIRECTORY="$HOME/my-project" bash scripts/start-pocket.sh
```

## Development

Install dependencies:

```bash
npm install
```

Run the backend:

```bash
npm run dev:server
```

Run Vite in another terminal:

```bash
npm run dev:web
```

Build:

```bash
npm run build
```

Start the built app:

```bash
npm start
```

Current package version: **0.2.0**.

## Compatibility

DevMoter talks to upstream CLIs and protocols that can change over time.

The project has recently been developed against the OpenCode v2 API and Codex app-server protocol. Version-sensitive compatibility handling exists for areas such as event envelopes, streamed deltas, image input, model changes, approvals, plugins, and MCP inventory.

If a newer upstream version breaks DevMoter, please include exact version numbers when filing an issue.

## Project status

**Alpha / active development.**

Already implemented:

- three backend surfaces;
- mobile PWA shell;
- streaming and interruption;
- approvals/permission flows;
- project workspace and Markdown editing;
- GitHub repository integration;
- automated tests and coverage;
- CI checks;
- localhost-first launcher and health checks.

Still being improved:

- first-run installation and upgrade experience;
- DevMoter-native authentication;
- reconnect/offline resilience;
- richer Git/diff UX;
- upload cleanup and retention;
- broader upstream-version compatibility;
- accessibility and device testing;
- packaging/background-service setup;
- screenshots and demo material.

## Contributing

Issues, bug reports, protocol findings, documentation improvements, and pull requests are welcome.

For compatibility bugs, please include:

- DevMoter commit;
- OpenCode / Codex version as applicable;
- browser / PWA environment;
- exact error text;
- the action that triggered the problem.

Never post API keys, login tokens, Tailscale credentials, generated OpenCode passwords, or other secrets in an issue.

## AI-assisted development

This project is built with heavy AI assistance.

AI tools are used for implementation, debugging, protocol research, tests, and iteration. Product direction, requirements, target-device testing, release decisions, and maintenance are human-directed.

The project aims to keep that process visible rather than pretending the code was produced without AI assistance.

## Related files

- `SPEC.md` — early project specification
- `PROMPT_FOR_CODEX.md` — implementation / handoff context
- `.env.example` — environment-variable example
- `.github/workflows/ci.yml` — automated CI checks

## License

DevMoter FAST is licensed under the **MIT License**.

See [LICENSE](./LICENSE) for the full license text.

## Source provenance

This repository starts from an audited clean snapshot. Historical private development branches are intentionally not included in this repository history.
