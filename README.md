# DevMoter FAST

**Your coding agents. One pocket-sized control plane. 📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

**English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

DevMoter FAST is an **open-source, self-hosted, mobile-first control plane for coding agents**. Keep Codex, OpenCode, repositories, credentials, and tools on your Linux host; use a phone, tablet, or browser as the control surface.

It is more than a chat wrapper: DevMoter connects agent sessions, projects, Git/GitHub workflows, reviewed changes, API-model chat, host integrations, automation, and safety boundaries behind one UI.

> [!IMPORTANT]
> **Alpha / active development.** DevMoter FAST is an unofficial community project and is not affiliated with or endorsed by OpenAI, OpenCode, GitHub, Anthropic, Google, Tailscale, or other referenced providers.

> [!WARNING]
> DevMoter is currently designed for a **single-user private host / private network**. Keep it bound to localhost and use private HTTPS access such as Tailscale Serve. Do not expose DevMoter or agent backends directly to the public internet.

## What is it?

```text
Phone / tablet / browser / PWA
              │
              │ private HTTPS
              ▼
       DevMoter FAST
      mobile control plane
        │      │      │
        ▼      ▼      ▼
     Codex  OpenCode  API Chat
        │      │      │
        └──────┼──────┘
               ▼
       projects · Git · tools
               │
               ▼
          Linux host
```

The browser never needs to become the coding machine. DevMoter keeps local paths, agent processes, provider credentials, and repository state on the host.

## Why DevMoter?

Coding agents can run for minutes or hours, but their normal interfaces assume you are sitting at the development machine. DevMoter is built around a different workflow:

**start work on the host → leave the desk → inspect, approve, interrupt, switch context, or continue from your phone.**

That makes it useful for Linux workstations, Chromebook/Crostini environments, home servers, and other always-on development hosts.

## Capability status

We deliberately distinguish **shipped**, **experimental**, and **planned** functionality. A visible idea in the repository is not automatically a shipped feature.

| Surface | Status | What is wired today |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions, agents, models/providers, modes, commands, skills, streaming, permissions/questions, interrupt |
| Codex | ✅ Shipped | threads, resume/fork, dynamic model discovery, reasoning effort, streaming, approvals, attachments, plugins/MCP inventory |
| Projects | ✅ Shipped | registered working directories, project switching, bounded Markdown browsing/editing |
| GitHub workspace | ✅ Shipped | host-`gh` repository discovery, managed clone/open, branch/fetch safety checks |
| API Chat | 🧪 Experimental | configurable providers/models, reasoning modes, image attachments |
| Reviewed changes / task workflow | 🧪 Experimental | proposals, hunk review, drift checks, apply/commit/worktree/PR workflow |
| Agent/control-plane automation | 🧪 Experimental | host registry, schedules/triggers, bounded automation primitives |
| Antigravity / Claude integrations | 🧪 Experimental | local integration discovery and selected launch/remote handoff flows |
| PWA / mobile UI | ✅ Shipped | backend switching, responsive UI, reconnect state, installable shell |
| Passkey/device controls | 🧪 Experimental | optional secondary controls; not a public multi-user authorization system |
| Library | 🗺️ Planned | not yet a shipped storage/library surface |
| Google / Microsoft / Apple sign-in | 🗺️ Planned | UI roadmap only; not implemented |

> [!NOTE]
> Upstream availability is dynamic. For example, DevMoter's Codex model picker uses the models advertised by the installed Codex app-server rather than fabricating model availability.

## Quick start

### Requirements

- Linux
- Node.js 22 + npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

Optional: GitHub CLI (`gh`) for repository integration and Tailscale for private phone access.

Authenticate the upstream CLIs using their own supported flows before starting DevMoter.

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

The normal launcher builds the app, prepares local authentication, starts the localhost OpenCode runtime, starts DevMoter, and performs readiness checks. Codex app-server is launched over stdio rather than exposed as a network service.

For the shortest supported setup, see **[Fast Install](./fastinstall.MD)**. For systemd and update operations, see **[Operations](./docs/operations.md)**.

## Private phone access

DevMoter is intended to remain on localhost. With Tailscale installed:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the resulting private HTTPS URL from a device on the same tailnet.

> [!CAUTION]
> Tailscale Funnel and arbitrary public tunnels are not the recommended deployment model for the current alpha. DevMoter's login is a single-user access boundary, not public-SaaS authorization.

## Three agent surfaces

### Codex

DevMoter talks to the local Codex app-server over JSONL/stdin/stdout. The UI supports thread history, new/resume/fork flows, streamed turns, approvals, interruption, attachments, dynamic models, model-advertised reasoning effort, and plugin/MCP discovery.

Codex RPC methods cross an explicit server allowlist. Authentication remains owned by the local Codex CLI.

### OpenCode

DevMoter proxies a localhost OpenCode runtime without exposing its Basic Auth secret to the browser. The mobile surface supports sessions, agents, Plan/Ask/Build modes, provider/model selection, commands/skills, live text/reasoning/tool activity, permission requests, questions, and interruption.

### API Chat

The experimental API Chat surface provides a compact multi-provider interface. Provider credentials are configured on the host; the frontend does not receive stored API keys back after configuration.

## Projects, Git and reviewed changes

A selected project is represented by a DevMoter project identity rather than an arbitrary browser-supplied working directory.

Filesystem boundaries include:

- registered projects stay inside the user's home directory;
- traversal and project-root escapes are rejected;
- symlink boundaries are checked around sensitive file operations;
- the mobile editor is intentionally limited to bounded Markdown writes;
- GitHub clones use a managed repository root;
- dirty worktrees block destructive/reuse operations where appropriate.

The experimental reviewed-changes workflow adds proposal review, per-hunk decisions, context-drift checks, apply/commit validation, managed worktrees, and PR-oriented task flows.

## Security model

DevMoter assumes that **the authenticated user is the owner of the host**. It is not currently a multi-tenant service.

Key boundaries include:

- localhost binding by default;
- DevMoter-native authentication;
- exact-origin checks for state-changing browser requests;
- `no-store` handling for secret-bearing/API responses;
- OpenCode credentials kept server-side;
- Codex reached over stdio with RPC allowlisting;
- registered-project filesystem boundaries;
- host-local attachment storage;
- GitHub credentials retained in the host `gh` session;
- fixed-argument host integration launchers rather than browser-provided shell commands.

Read **[SECURITY.md](./SECURITY.md)** and **[THREAT_MODEL.md](./THREAT_MODEL.md)** before remote deployment.

### Known alpha caveats

Security and integration auditing is active. Some experimental surfaces still need stronger end-to-end contract coverage, and upstream Codex/OpenCode/CLI behavior can change independently of DevMoter. Treat `main` as development software, not a hardened public service.

## Architecture & documentation

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

CI runs the automated checks, but real Chromebook/Crostini + iPhone behavior is still covered by the manual release smoke checklist.

## Compatibility

DevMoter integrates with upstream tools whose protocols can evolve. Compatibility handling exists for event envelopes, streaming, approvals, images, model changes, plugins, MCP inventory, and other version-sensitive behavior.

When reporting a compatibility issue, include:

- DevMoter commit;
- relevant Codex/OpenCode version;
- browser/PWA environment;
- exact error text;
- the action that triggered it.

Do **not** include API keys, tokens, generated passwords, private repository contents, or other secrets.

## Project principles

1. **Host-local by default.** Credentials and coding processes stay on your machine.
2. **Mobile is a first-class control surface.** This is not a desktop page squeezed onto a phone.
3. **Agent actions need boundaries.** Filesystem, Git, RPC, automation, and host integration paths should fail closed.
4. **No fake capability.** Planned or upstream-dependent features should be labeled as such.
5. **Interoperability over lock-in.** DevMoter connects existing coding tools rather than pretending to replace all of them.

## AI-assisted development

DevMoter FAST is built with heavy AI assistance for implementation, debugging, protocol research, tests, and iteration. Product direction, requirements, real-device validation, release decisions, and maintenance remain human-directed.

## Contributing

Issues, compatibility findings, documentation improvements, security reports, and pull requests are welcome.

Security vulnerabilities should follow **[SECURITY.md](./SECURITY.md)** rather than being posted with exploit details in a public issue.

## License

MIT. See [LICENSE](./LICENSE).

---

**DevMoter FAST — leave the coding machine running; carry the control plane with you.**
