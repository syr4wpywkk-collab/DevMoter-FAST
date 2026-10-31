# DevMoter FAST

**A self-hosted control plane for AI-assisted software engineering.**  
Run agents and developer tools on your own machine. Operate, coordinate, and review the work from the device in your pocket.

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

**English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> **Product generation:** v3.0.0-alpha  
> **Release status:** pre-release / active development  
> **npm package version:** `0.2.0` (private package metadata; independent of the product generation)

DevMoter FAST is an **open-source, self-hosted, mobile-first control plane for AI-assisted software engineering**. It brings coding agents, projects, Git workflows, reviews, developer tools, and host integrations into one coordinated workspace while keeping execution and credentials on the machine you control.

This is a new product generation—not simply a remote chat client with more buttons. DevMoter is designed to become the operational layer between you, your coding agents, your repositories, and the host that runs them.

> [!IMPORTANT]
> DevMoter FAST is an independent community project. It is not affiliated with, sponsored by, or endorsed by OpenAI, OpenCode, GitHub, Anthropic, Google, Tailscale, or any other provider mentioned here.

> [!WARNING]
> The current security model is **single-owner and host-local**. Keep the server bound to localhost and use a private network such as Tailscale for remote access. Do not expose DevMoter, agent backends, or host-control endpoints directly to the public internet.

## The idea

Your development machine remains the execution environment. DevMoter provides the control and coordination layer.

- **You** decide what should happen and approve important actions.
- **Agents** perform coding, investigation, and supported workflow tasks.
- **Projects** provide registered, scoped access to repositories and context.
- **Reviews and Git workflows** make proposed changes inspectable before they are applied.
- **The host** owns processes, files, credentials, and local integrations.
- **Your phone or browser** becomes the mobile-first control surface.

The goal:

**Keep the engineering environment running. Take its control plane with you.**

## What DevMoter brings together

| Area | What it does | Maturity |
| --- | --- | --- |
| Agent workspace | OpenCode and Codex sessions, streaming, model/agent selection, approvals and interruption | Shipped; upstream-dependent |
| Projects | Registered project identities, project switching, bounded file and Markdown access | Shipped |
| GitHub workspace | Host-authenticated repository discovery and managed repository operations | Shipped; scope-limited |
| Tools AI | Natural-language requests routed to bounded project and host observations | Experimental |
| Reviewed Changes | Diff proposals, file/hunk review, drift checks, explicit apply and commit flows | Experimental |
| Session control | Follow-ups, handoff, checkpoints, forks, transcript search and background-run controls | Experimental |
| Terminal | Authenticated, project-scoped persistent terminal with bounded replay and reconnect | Experimental |
| API Chat and routing | Configurable providers/models, reasoning controls, attachments and routing/failover | Experimental |
| Developer workflows | Skills, rules, MCP management, optional ACP, extensions and configured verification/review workflows | Mixed; see docs |
| Host protocol | Versioned capability discovery across host adapters | v1 discovery contract; adapters vary |
| Automation and integrations | Host registry, bounded triggers/schedules and selected integration handoffs | Experimental |
| Web/PWA | Responsive mobile-first control surface and installable web shell | Shipped |
| iOS client | Native wrapper for connecting to an existing DevMoter server over HTTPS | Experimental; device validation required |

**Maturity labels matter.** Shipped means a real backend path exists; Experimental means implementation exists but still needs hardening or broader validation; Planned means it is not available as a shipped feature. A UI entry or design document is not proof that a capability works.

## How it fits together

```text
 Phone · Tablet · Browser · PWA · iOS client
                    │
                    │ private HTTPS
                    ▼
          ┌──────────────────────┐
          │     DevMoter FAST    │
          │  Auth · UI · Routing │
          │  Projects · Reviews │
          │  Host capability API │
          └──────────┬───────────┘
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
       OpenCode    Codex      API providers
       localhost   stdio       HTTPS
          │          │           │
          └──────────┼───────────┘
                     ▼
        Projects · Git · Tools · Tasks
         Terminal · Integrations · State
                     │
                     ▼
               Your host machine
```

The browser is a controller, not a remote shell with unrestricted authority. It sends authenticated, bounded requests; the server resolves registered resources and applies the relevant checks. Agent processes, repository data, local paths, and provider credentials remain on the host wherever the integration permits.

## A typical workflow

1. Register or select a project.
2. Start or resume a supported agent session.
3. Work from your phone or browser while the host runs the agent.
4. Inspect progress, tool activity, and bounded project context.
5. Interrupt, follow up, or hand off work when supported.
6. Review proposed diffs and check for context drift.
7. Explicitly apply or commit changes when the workflow supports it.
8. Continue through GitHub and configured verification/review tools.

Not every surface has the same maturity. Consult the status table and linked contracts before relying on an experimental workflow.

## Agent and developer surfaces

### OpenCode

DevMoter connects to a local OpenCode runtime and keeps its backend authentication material on the server side. The workspace supports sessions, agents, provider/model selection, modes, commands, skills, streaming activity, permission requests, questions, and interruption, subject to the installed OpenCode version.

### Codex

DevMoter communicates with the local Codex app-server over stdio/JSONL. Supported integration areas include threads, history, resume/fork, streamed turns, interruption, approvals, attachments, dynamic model discovery, reasoning effort, and plugin/MCP inventory. RPC access is restricted by a server-side allowlist. Authentication remains with the local Codex CLI.

### API Chat and model routing

The experimental API Chat surface supports configured providers and models, reasoning controls, attachments, and routing/failover behavior. Provider credentials are stored server-side and are not returned to the frontend after configuration.

### Projects, Git, and reviewed changes

The browser selects a registered Project ID rather than supplying an arbitrary working directory. Project operations are bounded by server-side path checks. The managed GitHub workspace uses the host's authenticated `gh` session and applies managed-path and worktree safety checks.

The experimental review flow is designed around inspectability:

- propose a change;
- inspect files and individual hunks;
- validate that the original context has not drifted;
- explicitly apply the accepted change;
- validate before commit;
- use managed task worktrees and PR-oriented flows where available.

### Tools AI and local context

Tools AI accepts a natural-language goal and can route it to supported, bounded observations such as Git changes, saved-index search, project maps, Markdown reads, and fixed host diagnostics. It is not an unrestricted autonomous shell. Run state, cancellation behavior, reconnect behavior, and limitations are documented in the [Tools AI contract](./docs/tools-ai-v1.md).

Local indexing and project-context features are experimental. Sensitive/vendor exclusions and bounded reads are part of the design; availability depends on the host's indexed state.

### Terminal, integrations, and automation

The persistent terminal is authenticated and project-scoped, with bounded output replay and reconnect behavior. Host integrations and automation use registered resources and bounded operations. Repository-provided files are treated as untrusted input: discovering a manifest, skill, or rule does not mean its commands are automatically executed.

Developer workflows include explicit controls for skills, rules, MCP servers, optional ACP adapters, extension declarations, verification commands, and read-only AI review. See [Developer workflows](./docs/developer-workflows.md).

## Host protocol and platform support

The authenticated `GET /api/host` endpoint exposes a versioned capability snapshot. Clients must use the advertised capability state rather than infer support from the operating system.

Host Protocol v1 is a **discovery contract**, not a universal replacement for all existing APIs. Some capability families are unavailable or only partially implemented on particular adapters. For example, the current documentation identifies Linux support, constrained WSL behavior, and an unimplemented native macOS adapter. The Secret Vault management surface also has documented limits and is not yet a general provider/agent secret-injection system.

See [Host Protocol v1](./docs/HOST_PROTOCOL.md) for the exact contract and limitations.

## Security model

DevMoter is built around a private, single-owner host—not public multi-tenant hosting.

Core principles include:

- bind the server to localhost by default;
- use DevMoter authentication and exact-origin checks for state-changing browser requests;
- keep provider and upstream credentials server-side;
- use explicit Codex RPC allowlists;
- resolve filesystem access through registered project identities;
- enforce path containment and symlink checks around sensitive operations;
- bound request sizes, reads, output, and long-running workflows;
- treat repository-provided content as untrusted;
- require explicit approval for important mutations;
- avoid arbitrary browser-supplied shell commands.

These controls reduce exposure; they do not make an internet-facing deployment safe. Read [SECURITY.md](./SECURITY.md) and [THREAT_MODEL.md](./THREAT_MODEL.md) before remote use.

## Install

### Requirements

- Linux host
- Node.js 22 or newer and npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

Optional integrations include GitHub CLI (`gh`) and Tailscale. Authenticate upstream CLIs using their own supported flows before starting DevMoter.

### Quick start

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

Open:

```text
http://127.0.0.1:8787
```

For the supported installer, update flow, and user service, see [Operations](./docs/operations.md) and [Fast Install](./fastinstall.MD).

### Private access from a phone

Keep DevMoter on localhost and use a private HTTPS transport such as Tailscale Serve:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the private HTTPS address from a device on the same tailnet. Do not use Tailscale Funnel or an arbitrary public tunnel as a substitute for a public-ready authorization model.

### iOS client

The repository includes an iOS client that connects to an already-running DevMoter server over HTTPS. It does **not** run the Linux server or coding agents on the iPhone. IPA generation is handled by GitHub Actions; installation/signing and real-device checks are separate steps. See [iPhone / AltStore instructions](./docs/ios-altstore.md) and the [Linux-to-iPhone guide](./docs/iphone-linux.ja.md). Do not treat a successful Linux build or an IPA artifact as proof of physical-device compatibility.

## Development and validation

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Optional coverage report:

```bash
npm run test:coverage
```

CI covers automated checks. Chromebook/Crostini and iPhone behavior still require the documented manual release-smoke checks where equivalent device automation is unavailable. A passing unit test suite does not establish upstream protocol compatibility or real-device behavior.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | Server, browser, agent, and filesystem boundaries |
| [Security](./SECURITY.md) | Deployment assumptions and vulnerability reporting |
| [Threat model](./THREAT_MODEL.md) | Trust boundaries and attacker model |
| [Fast Install](./fastinstall.MD) | Quick setup |
| [Operations](./docs/operations.md) | Installer, updates, systemd user service, health checks |
| [Host Protocol v1](./docs/HOST_PROTOCOL.md) | Capability discovery and adapter limits |
| [Tools AI v1](./docs/tools-ai-v1.md) | Tools AI contracts, cancellation, data handling, limitations |
| [Developer workflows](./docs/developer-workflows.md) | Skills, rules, MCP, ACP, extensions, verification and review |
| [iOS / AltStore](./docs/ios-altstore.md) | iOS client build and installation |
| [Linux to iPhone](./docs/iphone-linux.ja.md) | Linux-based iPhone installation walkthrough |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | Browser automation boundary |
| [Remote-control security](./docs/remote-control-security.md) | Host registry and automation security |
| [Release smoke](./RELEASE_SMOKE.md) | Manual release validation |
| [Roadmap](./ROADMAP.md) | Maturity gates and future direction |

## Project principles

1. **Host-owned execution.** Keep coding processes and local resources on the machine that owns them.
2. **Mobile-first control.** The phone is a first-class workspace, not a shrunken desktop page.
3. **Least authority.** Agents and browser clients receive only bounded, scoped capabilities.
4. **Human approval for consequential changes.** Make mutations inspectable and deliberate.
5. **Honest maturity labels.** Do not describe planned or unvalidated behavior as shipped.
6. **Interoperability.** Coordinate existing developer tools instead of forcing a single provider or agent.

## Contributing

Issues, compatibility reports, documentation improvements, and pull requests are welcome. For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) rather than publishing exploit details in a public issue. Never include API keys, tokens, passwords, or private repository data in bug reports.

## License

MIT. See [LICENSE](./LICENSE).

---

**DevMoter FAST v3 — your engineering environment, under your control.**
