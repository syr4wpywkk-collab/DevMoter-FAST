# DevMoter FAST v2

**Your coding agents. One pocket-sized control plane. 📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

**English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> **Version track:** v2.0.0-alpha series  
> **Status:** active development / pre-release

DevMoter FAST is an **open-source, self-hosted, mobile-first control plane for coding agents and developer tools**.

Keep Codex, OpenCode, repositories, credentials, terminals, Git workflows, and host integrations on your Linux machine. Use a phone, tablet, PWA, or browser as the control surface.

DevMoter v2 is no longer just a remote chat wrapper. It is evolving into a host-local control plane that connects **agent sessions, projects, Git/GitHub workflows, reviewed changes, model routing, automation, local tools, and explicit safety boundaries** behind one mobile-first interface.

> [!IMPORTANT]
> DevMoter FAST is an unofficial community project. It is not affiliated with, sponsored by, or endorsed by OpenAI, OpenCode, GitHub, Anthropic, Google, Tailscale, or other referenced providers.

> [!WARNING]
> DevMoter is currently designed for a **single-user private host / private network**. Keep it bound to localhost and use private HTTPS access such as Tailscale Serve. Do not expose DevMoter or agent backends directly to the public internet.

## Why v2?

The first generation proved the core idea: start a coding agent on a Linux host and control it from your phone.

The v2 generation expands that idea into a broader control plane:

- multiple agent backends instead of one chat surface;
- project-aware sessions instead of arbitrary browser-provided working directories;
- Git/GitHub workflows instead of copy-pasting patches;
- reviewed changes, worktrees, and PR-oriented task flows;
- model/provider routing and API-model chat;
- persistent terminal and project context tools;
- local host integrations and bounded automation;
- stronger origin, filesystem, RPC, credential, and approval boundaries;
- a mobile UI designed as the primary control surface rather than a desktop page squeezed onto a phone.

The goal is simple:

**leave the coding machine running; carry the control plane with you.**

## Architecture at a glance

```text
Phone / tablet / browser / PWA
              │
              │ private HTTPS
              ▼
       ┌───────────────────┐
       │   DevMoter FAST   │
       │ mobile control    │
       │      plane        │
       └─────────┬─────────┘
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
     Codex    OpenCode   API Chat
       │         │         │
       └─────────┼─────────┘
                 ▼
     Projects · Git · Reviews
      Terminal · Tools · Tasks
                 │
                 ▼
             Linux host
```

The browser is the controller, not the coding machine. Local paths, agent processes, provider credentials, repository state, and host tooling remain on the host.

## Core workflow

A typical DevMoter workflow looks like this:

**start work on the host → leave the desk → inspect progress → approve or interrupt → switch agent/model/project → review changes → continue from your phone.**

This model is especially useful for:

- Linux workstations;
- Chromebook + Crostini environments;
- home servers;
- always-on development machines;
- users who want local tooling without carrying the full desktop UI everywhere.

## Capability status

DevMoter deliberately distinguishes **shipped**, **experimental**, and **planned** features. A visible button or repository document does not automatically mean a capability is production-ready.

| Surface | Status | Current scope |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions, agents, models/providers, modes, commands, skills, streaming, permissions/questions, interrupt |
| Codex | ✅ Shipped | threads, resume/fork, dynamic model discovery, reasoning effort, streaming, approvals, attachments, plugins/MCP inventory |
| Projects | ✅ Shipped | registered working directories, project switching, bounded Markdown browsing/editing |
| GitHub workspace | ✅ Shipped | host-`gh` repository discovery, managed clone/open, branch/fetch safety checks |
| Session control | 🧪 Experimental | handoff, follow-ups, checkpoints, rewind/fork flows, transcript search, background-run controls |
| Reviewed changes / tasks | 🧪 Experimental | proposal review, hunk decisions, drift checks, apply/commit, worktree, PR flow |
| Project context / local index | 🧪 Experimental | bounded project search, structure/symbol context, local indexing |
| Persistent terminal | 🧪 Experimental | authenticated project-scoped terminal with bounded replay and reconnect |
| API Chat / model routing | 🧪 Experimental | configurable providers/models, reasoning modes, routing/failover, image attachments |
| Automation / control plane | 🧪 Experimental | host registry, schedules/triggers, bounded automation primitives |
| Antigravity / Claude integrations | 🧪 Experimental | local integration discovery and selected launch/remote handoff flows |
| PWA / mobile UI | ✅ Shipped | responsive UI, backend switching, reconnect state, installable shell |
| Passkey / device controls | 🧪 Experimental | optional secondary controls; not a public multi-user authorization system |
| Library | 🗺️ Planned | not yet a shipped storage/library surface |
| Google / Microsoft / Apple sign-in | 🗺️ Planned | roadmap only; not implemented |

> [!NOTE]
> Upstream capabilities are dynamic. For example, the Codex model picker uses models advertised by the installed Codex app-server instead of inventing model availability.

## Agent surfaces

### Codex

DevMoter talks to the local Codex app-server over stdio/JSONL.

Current integrations include:

- thread creation, history, resume and fork;
- streamed turns and interruption;
- approvals;
- attachments;
- dynamic model discovery;
- model-advertised reasoning effort;
- plugin/MCP inventory;
- usage/rate-limit metadata where exposed by the upstream app-server.

Codex RPC methods cross an explicit server-side allowlist. Authentication remains owned by the local Codex CLI.

### OpenCode

DevMoter proxies a localhost OpenCode runtime while keeping its backend credentials away from the browser.

The mobile surface supports:

- sessions and agents;
- Plan / Ask / Build modes;
- provider and model selection;
- commands and skills;
- live text, reasoning and tool activity;
- permission requests and questions;
- interruption.

### API Chat

The experimental API Chat surface provides a compact multi-provider interface with configurable models, reasoning controls, routing, and attachments.

Stored provider credentials remain server-side and are not returned to the frontend after configuration.

## Projects, Git and reviewed changes

DevMoter uses a registered **Project ID** instead of accepting an arbitrary browser-supplied `cwd`.

Important boundaries include:

- registered projects stay inside the user's home directory;
- traversal and project-root escapes are rejected;
- symlink boundaries are checked around sensitive file operations;
- local project reads are bounded;
- mobile editor writes are intentionally constrained;
- GitHub clones use a managed repository root;
- dirty worktrees block destructive or unsafe reuse operations where appropriate.

The experimental reviewed-changes workflow adds:

1. proposed changes;
2. per-file / per-hunk review;
3. context-drift validation;
4. explicit apply;
5. commit validation;
6. managed task worktrees;
7. PR-oriented task flows.

The goal is not to make autonomous mutation invisible. The goal is to make important mutations **inspectable and bounded**.

## Local context and terminal

DevMoter v2 also adds host-local developer surfaces beyond chat.

Experimental capabilities include:

- project structure and symbol context;
- bounded local full-text indexing;
- sensitive/vendor path exclusions;
- reconnectable project-scoped terminal sessions;
- bounded terminal output replay;
- mobile-friendly terminal controls.

These features are designed around registered project boundaries rather than unrestricted browser-side shell access.

## Automation and integrations

The v2 architecture includes an experimental control-plane layer for host integrations and automation.

This includes pieces such as:

- host registry;
- bounded schedules and triggers;
- explicit integration discovery;
- selected launch/remote handoff flows;
- routing between supported agent/model surfaces.

Automation is not treated as an excuse to bypass authorization boundaries. High-impact operations should remain explicit, scoped, and auditable.

## Security model

DevMoter currently assumes that **the authenticated user is the owner of the host**. It is not a public multi-tenant SaaS authorization system.

Key boundaries include:

- localhost binding by default;
- DevMoter-native authentication;
- exact-origin checks for state-changing browser requests;
- `no-store` handling for secret-bearing/API responses;
- provider credentials retained server-side;
- OpenCode credentials kept away from the browser;
- Codex reached over stdio with RPC allowlisting;
- registered-project filesystem boundaries;
- realpath/symlink containment checks around sensitive paths;
- host-local attachment storage;
- GitHub credentials retained in the host `gh` session;
- fixed-argument host integration launchers instead of browser-provided shell commands;
- bounded approval and task workflows.

Read **[SECURITY.md](./SECURITY.md)** and **[THREAT_MODEL.md](./THREAT_MODEL.md)** before remote deployment.

### Alpha caveats

The v2.0.0-alpha line is still development software.

Security and integration auditing is active. Experimental surfaces may change, and upstream Codex/OpenCode/CLI behavior can evolve independently of DevMoter.

Treat `main` as a development branch, not as a hardened public service.

## Quick start

### Requirements

- Linux
- Node.js 22 + npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

Optional:

- GitHub CLI (`gh`) for repository integration;
- Tailscale for private phone access.

Authenticate upstream CLIs using their own supported flows before starting DevMoter.

### Install

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

Then open:

```text
http://127.0.0.1:8787
```

The normal launcher builds the app, prepares local authentication, starts the local runtime pieces, starts DevMoter, and performs readiness checks.

For the shortest supported setup, see **[Fast Install](./fastinstall.MD)**. For systemd and update operations, see **[Operations](./docs/operations.md)**.

## Private phone access

DevMoter is intended to remain on localhost.

With Tailscale installed:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the resulting private HTTPS URL from a device on the same tailnet.

> [!CAUTION]
> Tailscale Funnel and arbitrary public tunnels are not the recommended deployment model for the current alpha. DevMoter's login is a single-user access boundary, not public-SaaS authorization.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | process, browser, agent and filesystem boundaries |
| [Security](./SECURITY.md) | deployment assumptions and vulnerability reporting |
| [Threat model](./THREAT_MODEL.md) | trust boundaries and attacker model |
| [Fast Install](./fastinstall.MD) | shortest supported install path |
| [Operations](./docs/operations.md) | systemd, update and operational commands |
| [Developer workflows](./docs/developer-workflows.md) | extensions, MCP, ACP, skills and rules |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | browser automation boundary |
| [Remote-control security](./docs/remote-control-security.md) | host registry / automation security |
| [Release smoke](./RELEASE_SMOKE.md) | real-device release checklist |
| [Roadmap](./ROADMAP.md) | current direction and maturity gates |

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Coverage:

```bash
npm run test:coverage
```

CI covers automated checks. Real Chromebook/Crostini + iPhone behavior is still covered by the manual [Release Smoke](./RELEASE_SMOKE.md) checklist.

## Compatibility

DevMoter integrates with upstream tools whose protocols can evolve.

Compatibility handling exists for areas such as:

- event envelopes;
- streaming;
- approvals;
- images and attachments;
- model changes;
- plugins and MCP inventory;
- provider metadata;
- version-sensitive RPC behavior.

When reporting a compatibility problem, include:

- DevMoter commit;
- relevant Codex/OpenCode version;
- browser/PWA environment;
- exact error text;
- the action that triggered it.

Do **not** include API keys, tokens, generated passwords, private repository contents, or other secrets.

## Project principles

1. **Host-local by default.** Credentials and coding processes stay on your machine.
2. **Mobile is a first-class control surface.** This is not a desktop page squeezed onto a phone.
3. **Agent actions need boundaries.** Filesystem, Git, RPC, automation, approvals, and host integrations should fail closed.
4. **Important mutations should be inspectable.** Review and explicit consent beat invisible automation.
5. **No fake capability.** Planned or upstream-dependent features should be labeled honestly.
6. **Interoperability over lock-in.** DevMoter connects existing developer tools rather than pretending to replace all of them.

## AI-assisted development

DevMoter FAST is built with heavy AI assistance for implementation, debugging, protocol research, testing, review, and iteration.

Product direction, requirements, real-device validation, release decisions, and maintenance remain human-directed.

## Contributing

Issues, compatibility findings, documentation improvements, security reports, and pull requests are welcome.

Security vulnerabilities should follow **[SECURITY.md](./SECURITY.md)** instead of being posted with exploit details in a public issue.

## License

MIT. See [LICENSE](./LICENSE).

---

**DevMoter FAST v2 — leave the coding machine running; carry the control plane with you.**
