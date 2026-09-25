# DevMoter FAST Installer v2 — Design

Status: **Experimental / Phase 2.5 limited execution (Codex/OpenCode user npm only)**
Target: DevMoter FAST Alpha
Primary goal: **installation should cost time, not expertise.**

## 1. Product goal

A new user should be able to bootstrap DevMoter FAST with one small entry command, move into a guided local setup UI, choose the developer tools they want, authenticate through each tool's supported login flow, and finish with a working local + private mobile endpoint.

The desired journey is:

```text
bootstrap command
      ↓
local Setup Wizard
      ↓
environment scan
      ↓
choose tools
      ↓
review install plan
      ↓
install / verify
      ↓
connect accounts
      ↓
install + start DevMoter service
      ↓
configure private remote access
      ↓
health / capability checks
      ↓
desktop URL + phone URL + QR
```

The wizard must be resumable. Closing the browser or failing halfway through must not require starting over.

## 2. Target tools

Initial adapters:

| Tool | Detect | Install | Auth | Verify | Notes |
| --- | --- | --- | --- | --- | --- |
| DevMoter FAST | required | yes | local owner setup | health | core |
| OpenAI Codex CLI | optional/recommended | adapter | official CLI/browser flow | CLI + app-server probe | never collect OpenAI password |
| OpenCode CLI | optional/recommended | adapter | upstream-supported flow/config | CLI/runtime probe | preserve existing config |
| Claude Code CLI | optional | adapter | official CLI/browser flow | CLI probe | no credential scraping |
| Antigravity CLI | optional | adapter | supported upstream flow if available | CLI probe | exact package/command must be verified before implementation |
| GitHub CLI | optional/recommended | adapter | `gh auth login` / supported device/browser flow | `gh auth status` | host session remains source of truth |
| Tailscale | optional/recommended | adapter | official login/device flow | `tailscale status` | private remote path |

No adapter is considered implemented until its **current official installation and authentication method has been verified**. Product names in this document do not authorize guessing package names, download URLs, flags, or deep links.

## 3. UX

### Step A — Welcome

Explain in one screen:
- DevMoter stays on the user's machine.
- The wizard can install selected external tools.
- Existing installations/configuration will be detected and preserved.
- No third-party password is entered into DevMoter.

Buttons: **Scan this machine** / advanced options.

### Step B — Environment scan

Each component receives a state:

```text
✓ Installed + connected
✓ Installed
! Installed, update available
○ Not installed
× Broken / unsupported
… Checking
```

Show version and useful status, not raw secrets.

### Step C — Select tools

Recommended defaults may be preselected, but every third-party tool remains individually opt-in.

Example:

```text
Coding agents
[x] Codex
[x] OpenCode
[ ] Claude Code
[ ] Antigravity

Developer tools
[x] GitHub CLI

Remote access
[x] Tailscale
```

Already-working components show **Keep existing** instead of reinstall.

### Step D — Plan review

Before privilege-changing operations, show exactly what will happen:
- installer source/channel;
- package manager or verified installer mechanism;
- whether sudo/admin permission may be requested;
- files/config areas DevMoter expects to touch;
- services that will be enabled.

The user confirms once for the selected plan. OS/sudo may still prompt separately.

### Step E — Install

A progress screen streams **structured installer events**, not an unrestricted shell terminal.

```text
GitHub CLI       ✓ Installed
Codex CLI        ✓ Already installed
OpenCode         … Installing
Claude Code      ○ Skipped
Tailscale        … Waiting for OS permission
```

Failure of one optional adapter does not destroy successful work. Offer Retry / Skip / Details.

### Step F — Connect accounts

Every integration has an explicit auth state:

```text
GitHub       [Connect]  → ✓ Connected
OpenAI       [Connect]  → ✓ Connected
Anthropic    [Connect]  → ✓ Connected
Tailscale    [Connect]  → ✓ Connected
```

DevMoter starts the upstream-supported auth command/flow and observes completion. Browser/device-code URLs can be presented when supplied by the upstream tool. Password fields for these providers do not exist in DevMoter.

### Step G — DevMoter + remote access

Install/enable `devmoter-fast.service`, run health checks, then configure the supported private Tailscale Serve path if selected.

Final screen:

```text
Ready 🎉

This computer
http://127.0.0.1:8787

Your phone
https://<private-tailnet-host>/

[ QR code ]

✓ DevMoter
✓ Codex
✓ OpenCode
✓ GitHub
✓ Tailscale
```

Never invent the remote URL. Read it from a successful Tailscale configuration/status result.

## 4. Architecture

Do not implement Installer v2 as one giant shell script.

```text
bootstrap
   ↓
Setup Engine
 ├─ Environment detector
 ├─ Plan builder
 ├─ Adapter registry
 │   ├─ codex
 │   ├─ opencode
 │   ├─ claude
 │   ├─ antigravity
 │   ├─ github
 │   └─ tailscale
 ├─ Auth coordinator
 ├─ Progress/event store
 ├─ Diagnostics
 └─ Setup API
          ↓
     Setup Wizard UI
```

Suggested server modules:

```text
server/setup/
  engine.mjs
  detector.mjs
  plan.mjs
  state.mjs
  auth.mjs
  diagnostics.mjs
  adapters/
    codex.mjs
    opencode.mjs
    claude.mjs
    antigravity.mjs
    github.mjs
    tailscale.mjs
```

The exact structure may change during implementation; the important boundary is **declarative adapters + centralized execution policy**.

## 5. Adapter contract

Conceptual interface:

```ts
interface SetupAdapter {
  id: string;
  displayName: string;

  detect(ctx): Promise<Detection>;
  plan(ctx): Promise<InstallPlan>;
  install(ctx, approvedPlan): AsyncIterable<SetupEvent>;
  authStatus(ctx): Promise<AuthState>;
  beginAuth(ctx): Promise<AuthChallenge>;
  verify(ctx): Promise<Verification>;
}
```

Adapters return structured data. They do not send arbitrary command strings from the browser.

A plan contains executable identity, fixed/validated argv, source, privilege requirement, expected side effects and verification method.

## 6. Setup state machine

```text
NEW
 → SCANNING
 → SELECTING
 → PLAN_READY
 → INSTALLING
 → AUTHENTICATING
 → CONFIGURING
 → VERIFYING
 → READY
```

Individual adapters additionally track:

```text
unknown | missing | installed | installing | auth_required |
auth_pending | ready | failed | skipped
```

State is persisted locally with no provider secrets. Re-running setup reconciles real machine state instead of blindly trusting saved state.

## 7. Idempotency

This is a hard requirement.

A second run must:
- detect existing binaries and versions;
- avoid reinstalling healthy components by default;
- preserve existing upstream authentication/config;
- reuse a healthy `devmoter-fast.service`;
- reconcile Tailscale state instead of resetting it unnecessarily;
- safely resume failed/skipped components;
- never remove unrelated packages/configuration.

There is no automatic uninstall in v1.

## 8. Security requirements

Installer v2 is a privileged surface and gets stricter rules than ordinary UI.

### No arbitrary shell API

The browser must never submit:
- executable paths;
- shell command strings;
- arbitrary argv;
- package URLs;
- arbitrary environment variables;
- sudo passwords.

It selects only known adapter IDs and predefined actions. The server owns executable discovery and arguments.

### No credential collection

DevMoter must not request or persist third-party account passwords, OAuth access tokens copied from web pages, GitHub PATs, or Tailscale auth keys as the normal interactive setup path.

Use upstream auth/device/browser flows and verify their resulting local session.

### Privilege escalation

Never capture a sudo password in the web UI. If an official installation path requires elevation, use the OS-native prompt/terminal path or provide a copyable, narrowly scoped command with an explanation.

Long-term unattended root installation is out of scope for the first version.

### Supply chain

Every adapter must document:
- official upstream source;
- supported installation mechanism;
- package/release identity;
- version detection;
- verification method.

Avoid `curl | bash` as the only path. If an upstream officially uses a bootstrap script, show its origin and prefer pinned/reviewable mechanisms where practical.

### Setup API lifetime

The bootstrap/setup server is especially sensitive before normal DevMoter auth exists.

Requirements:
- localhost-only;
- short-lived setup session capability;
- random unguessable bootstrap secret or equivalent local handoff;
- Origin validation;
- no remote setup API by default;
- invalidate bootstrap capability when setup completes;
- normal owner authentication takes over before private remote access is enabled.

## 9. Bootstrap strategy

Desired public UX may eventually be one command, but the implementation should have two layers:

1. **tiny auditable bootstrap** — checks platform/prerequisites, obtains/starts DevMoter setup safely;
2. **versioned Setup Wizard** — all complex behavior lives in the repository/application and is testable.

Potential final entry points:

```text
devmoter setup
```

and a documented first-install bootstrap.

Do not finalize a public `curl ... | bash` URL until release distribution, integrity/version policy and rollback are designed.

## 10. Platform scope

### v1 supported
- Linux
- Debian/Ubuntu-family first
- Chromebook/Crostini as a first-class real-device target
- systemd user service when available

### Later
- additional Linux distributions
- macOS
- Windows/WSL where the agent/tool ecosystem is verified

Unsupported platforms receive an explicit explanation rather than best-effort destructive commands.

## 11. Remote-access handoff

Tailscale setup is part of the wizard, but Tailscale remains a separate security boundary.

Flow:
1. detect binary;
2. install if explicitly selected;
3. detect login state;
4. launch supported login if needed;
5. verify tailnet state;
6. configure private Serve → `127.0.0.1:8787`;
7. read actual resulting HTTPS endpoint;
8. show URL + QR;
9. test DevMoter health through the configured path when feasible.

Do not enable Funnel by default.

## 12. Failure and recovery

Every step must answer:
- what failed?
- what already succeeded?
- is retry safe?
- can the user skip it?
- where are sanitized logs?

Logs must redact known secret/token patterns. The UI should expose a diagnostic bundle that defaults to metadata/version/error information, not private repo contents or credentials.

## 13. Testing

### Unit
- adapter detection parsing;
- plan validation;
- state transitions;
- redaction;
- idempotency decisions;
- unsupported-platform behavior.

### Integration
Use fake executables/temp PATH to test:
- missing → install → detected;
- installed → no reinstall;
- auth required → challenge → ready;
- command failure and retry;
- malicious browser arguments cannot alter executable/argv;
- partial setup resume.

### Real-device release smoke
At minimum:
- clean-ish Chromebook/Crostini;
- existing DevMoter installation;
- partially installed toolchain;
- logged-out/logged-in GitHub/Codex/etc.;
- Tailscale disconnected/connected;
- service restart;
- iPhone QR/remote handoff.

No adapter graduates to Shipped solely from mocked tests.

## 14. Telemetry/privacy

No setup telemetry is required for v1.

If telemetry is introduced later, it must be opt-in and must never contain:
- account identifiers;
- auth/device codes;
- tokens;
- repository names/paths;
- command output containing secrets.

## 15. Implementation phases

### Phase 0 — contracts
- verify current official install/auth flows for each target tool;
- freeze adapter contract;
- threat-model setup bootstrap/API.

### Phase 1 — detection + diagnostics
- environment scan;
- versions/auth status;
- Setup Wizard read-only dashboard.

### Phase 2 — installation
- plan review;
- GitHub/Tailscale + agent adapters;
- structured progress;
- retry/resume/idempotency.

### Phase 3 — authentication
- official browser/device/CLI flows;
- auth completion detection;
- no credential capture.

### Phase 4 — DevMoter + remote handoff
- service install/health;
- private Tailscale Serve;
- actual URL + QR;
- final capability report.

### Phase 5 — hardening
- clean-machine and partial-machine matrices;
- supply-chain checks;
- failure injection;
- security audit;
- documentation + release smoke.

## 16. Definition of done

Installer v2 is ready for an Alpha release when a supported Linux user can:

1. run the documented bootstrap;
2. understand what will be installed;
3. select desired tools;
4. install them without manually researching package commands;
5. authenticate through official provider flows without giving DevMoter their passwords;
6. resume after an interruption;
7. reach a healthy DevMoter service;
8. receive a verified private phone URL/QR when Tailscale is selected;
9. re-run setup without breaking an existing environment.

The success metric is simple:

> **The user may need to wait and approve official login/OS prompts, but should not need to understand the installation plumbing.**


## 17. Verified adapter compatibility matrix (2026-09-23)

This section is the Phase 0 research baseline. **Re-check upstream documentation immediately before implementation**, because installer/auth behavior is external and version-sensitive.

| Adapter | Linux install baseline | Binary / detect | Interactive auth baseline | Auth verification | v1 implementation decision |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | Official standalone installer; npm `@openai/codex` remains an alternative | `codex`, `codex --version` | Launch `codex` / supported ChatGPT sign-in; API/access-token modes exist but are not the default wizard path | Prefer a supported status/probe command or app-server/account probe; never parse credential files as the primary contract | **Implement** |
| OpenCode | Official installer or current official package-manager route | `opencode`, `opencode --version` | Provider configuration is provider-specific; current UI/docs expose `/connect` and auth/provider flows | Use supported provider/auth listing where available plus a runtime probe | **Implement**, but do not pretend there is one universal OpenCode account |
| Claude Code | Current official native/managed installer path; package-manager route only if still officially supported at implementation time | `claude`, version/doctor probe | Launch official Claude Code authentication flow; Claude.ai/Console/enterprise options are upstream-owned | `claude doctor` plus supported authenticated-session probe | **Implement** |
| Antigravity CLI | Official Google installer currently installs `agy` under the user's local bin path | `agy` + version/help probe | Existing secure keyring can sign in silently; otherwise local browser Google sign-in; SSH can emit URL/code flow | Start/probe CLI and observe supported auth/session status without reading keyring secrets | **Implement** |
| GitHub CLI | Official distro/package-manager instructions | `gh`, `gh --version` | `gh auth login`, browser flow by default | `gh auth status` | **Implement** |
| Tailscale | Official distro repository/package instructions or official installer | `tailscale`, version + daemon/status | `tailscale up` emits/opens supported login flow when needed | `tailscale status` | **Implement** |

### 17.1 Codex adapter notes

Current official Codex distribution supports a standalone installer on Linux/macOS and also the `@openai/codex` npm package. Installer v2 should prefer a user-level, officially supported path that does not require DevMoter to manage npm global permissions when practical.

The normal consumer setup path is **Sign in with ChatGPT**. DevMoter must initiate or surface the upstream flow rather than collect OpenAI credentials. API-key, enterprise access-token and workload-identity modes are advanced/existing-environment states: detect/preserve them, but do not silently replace them.

The adapter must verify that the installed CLI supports the app-server behavior DevMoter requires, not merely that a `codex` binary exists.

### 17.2 OpenCode adapter notes

OpenCode is different from Codex/Claude: installation and provider authentication are separate concerns. A healthy OpenCode binary can legitimately have zero or multiple configured providers.

Therefore model these independently:

```text
OpenCode installation: missing | ready | incompatible
OpenCode providers: none | configured | needs_attention
```

The wizard may offer **Configure providers**, but v1 must not ingest provider API keys into a generic DevMoter setup form. Prefer upstream/provider-specific connection flows. Existing OpenCode auth/config must be preserved.

OpenCode's published package/install surface has changed over time. The adapter implementation must pin its expected distribution identity in tests and re-check the canonical docs rather than accepting similarly named third-party packages.

### 17.3 Claude Code adapter notes

Claude Code's installation guidance has evolved from npm toward native/managed installation. Codex implementing this adapter must inspect the current official Anthropic documentation at implementation time and choose the currently recommended Linux path.

Do not run `sudo npm install -g` as a fallback. Authentication belongs to Claude Code: DevMoter launches the supported flow and waits for a verifiable result.

Enterprise Bedrock/Vertex configurations count as valid pre-existing states and must not be overwritten.

### 17.4 Antigravity adapter notes

The current official Antigravity CLI binary is `agy`. Google's installer targets a user-local binary path and authentication can reuse a secure OS keyring or open Google Sign-In; SSH/headless use can produce an authorization URL/code flow.

DevMoter should use the **account-based upstream flow** for interactive setup. Gemini API-key mode is an advanced configuration and must not lead the wizard to ask users to paste a Gemini key into DevMoter.

Because the official fast path is a remote installer script, implementation must decide whether to:
1. invoke the verified official installer after plan review; or
2. download/inspect/execute it as a separately auditable step.

Whichever route is chosen, the plan UI must show the exact official origin and must not accept an installer URL from the browser.

### 17.5 GitHub adapter notes

`gh auth login` uses a browser-based flow by default. `gh auth status` is the verification contract. Existing authenticated hosts must be preserved.

Do not request a PAT in the Setup Wizard. Environment-provided `GH_TOKEN`/enterprise credentials are valid pre-existing states and should be reported without revealing values.

### 17.6 Tailscale adapter notes

Current Linux guidance supports distribution packages and an official installer. Authentication is initiated with `tailscale up`. Tailscale Serve is private-tailnet sharing; Funnel is public exposure and is **not** part of the default setup.

After authentication, Installer v2 should configure only the intended reverse proxy to DevMoter localhost and then read the actual Serve status/config. The QR code is generated from that verified URL.

Do **not** begin setup by running `tailscale serve reset`: an existing user may already have unrelated Serve configuration. Installer v2 needs a conflict-aware plan and must avoid destroying existing routes.

## 18. Installation-source policy

Adapters classify install mechanisms:

```text
A — signed/native distro repository or package manager
B — official standalone release/binary
C — official remote bootstrap script
D — third-party/community package
```

Preference is A/B where they are current and practical. C is allowed only when it is the upstream-supported route and the source is fixed server-side, disclosed in the plan, fetched over HTTPS, and covered by adapter tests. D is never an automatic default.

The Setup Engine must not dynamically scrape documentation and execute whatever command it finds. Install commands are **reviewed code**, versioned with DevMoter.

## 19. Auth challenge model

Different CLIs expose authentication differently, so `beginAuth()` returns a typed challenge instead of a guessed URL:

```ts
type AuthChallenge =
  | { kind: "already_authenticated" }
  | { kind: "browser"; url?: string; instructions: string }
  | { kind: "device_code"; url: string; userCode: string; expiresAt?: string }
  | { kind: "terminal"; instructions: string }
  | { kind: "external_config"; instructions: string }
  | { kind: "unsupported"; reason: string };
```

Rules:
- URLs must originate from a trusted adapter/upstream process, not arbitrary browser input.
- Device codes are ephemeral and must not be written to persistent setup logs.
- Never echo tokens or provider passwords.
- If an upstream CLI requires a TTY, use a narrowly scoped PTY owned by the adapter; do not expose the general DevMoter terminal as the setup API.
- Poll auth status with bounded timeout/backoff and allow user cancellation.

## 20. Privilege broker design

Linux package installation and Tailscale daemon setup may require root. The browser must never become a sudo-password terminal.

v1 strategy:
1. prefer user-level installers for coding-agent CLIs;
2. separate privileged system packages from user-level tools;
3. build an exact allowlisted privileged plan;
4. execute via a local OS-mediated elevation path only after explicit confirmation;
5. never persist elevation credentials.

If safe noninteractive elevation is unavailable, pause and show a narrowly scoped command for the user to run in their local terminal, then automatically resume detection afterward.

## 21. Codex implementation brief

This section is intentionally written as a handoff contract for a coding agent implementing Installer v2.

### Mission

Implement Installer v2 incrementally without weakening existing DevMoter authentication, project, command-execution or network boundaries.

### First PR: Phase 1 only

**Do not start by installing software.** The first implementation PR must be read-only:

1. create `server/setup/` with adapter registry, detector, normalized states and diagnostics;
2. implement detection adapters for Codex, OpenCode, Claude Code, Antigravity (`agy`), GitHub CLI and Tailscale;
3. expose an authenticated/local setup-status API returning only sanitized structured data;
4. add a Setup Wizard page that renders machine/tool status;
5. add fake-PATH integration tests for missing/installed/broken binaries;
6. add tests proving browser input cannot choose executable paths or argv;
7. update docs with the exact API/state contract.

No package installation, sudo, login initiation, Tailscale mutation or arbitrary terminal execution in PR 1.

### Required review checkpoints

After each phase:
- run typecheck, lint, tests and build;
- perform security review of every new process spawn;
- search for shell-string execution and reject it unless there is a documented unavoidable reason;
- inspect responses/logs for secrets and local-path overexposure;
- verify idempotency with a partially configured fake environment;
- keep Experimental labels until real-device smoke passes.

### Process-spawn rule

Prefer:

```js
spawn(resolvedExecutable, validatedArgv, {
  shell: false,
  env: filteredEnvironment
})
```

Never accept an executable, command string, install URL, cwd or arbitrary environment map directly from the setup browser request.

### Expected PR sequence

```text
PR 1  detector + read-only Setup Wizard
PR 2  install-plan engine + user-level adapters
PR 3  privileged package broker / GitHub + Tailscale install
PR 4  auth coordinator + provider handoffs
PR 5  service + Tailscale Serve + verified QR handoff
PR 6  failure injection, security hardening, real-device smoke/docs
```

Each PR should be independently reviewable and should reference the Installer v2 epic.

### Stop conditions

Codex must stop and open/record a blocking issue rather than guessing when:
- official upstream installation/auth behavior cannot be verified;
- a provider requires DevMoter to collect a password/token contrary to this design;
- an operation would overwrite existing auth/config without explicit migration semantics;
- safe privilege escalation cannot be implemented without broad shell access;
- a Tailscale Serve change would destroy unrelated existing configuration;
- a test requires weakening an existing security boundary.

## 22. Research sources

Phase 0 was checked against current official/upstream documentation on 2026-09-23:
- OpenAI Codex repository/documentation for current CLI installation and ChatGPT sign-in behavior;
- OpenCode canonical documentation for installation, provider connection and credential status;
- Anthropic Claude Code setup documentation for installation/authentication;
- Google Antigravity CLI installation/authentication documentation;
- GitHub CLI manual for `gh auth login` / `gh auth status`;
- Tailscale Linux installation, `tailscale up`, and Serve documentation.

These are research inputs, **not runtime dependencies**. Adapter behavior remains versioned code and must fail closed when observed upstream behavior no longer matches its contract.

## 23. Phase 1 implementation contract

Phase 1 is an experimental, read-only detector and dashboard. It does not implement installation, authentication handoff, service installation, remote access setup, QR generation, or resumable setup state. The Epic and later phases remain open.

The authenticated `GET /api/setup/status` route is available only when both the connected peer address and Host are loopback. It is also subject to the existing owner authentication, Origin checks, and optional passkey gate. The response contains Linux support information, Node/Git versions, and six tool summaries. It never contains executable paths, argv, cwd, environment values, raw process output, provider names, or credential material. `phase` is `experimental-phase-1`.

Each tool has `state` (`unknown`, `missing`, `installed`, `auth_required`, `ready`, `broken`, or `unsupported`), `installed`, a version-only string, nullable `authenticated`, `authState`, and fixed-code diagnostics. OpenCode uses `providerAuth` (`configured`, `none`, or `unknown`) independently; Phase 1 leaves it `unknown` because the documented listing is human-readable and does not cover environment-backed providers. OpenCode is not treated as one account and is never promoted to `ready` from provider presence alone.

The server owns the fixed executable names and arguments. The shared detector resolves each executable from the server PATH, runs only absolute resolved paths using `spawn` with `shell: false`, a filtered environment and bounded time/output, and starts from the home directory. The API accepts no command input. Repeated GET requests run a fresh scan and do not persist or mutate setup state.

Current Phase 1 auth checks are Codex `login status`, OpenCode `auth list` (output is not interpreted), GitHub CLI `auth status --active --hostname github.com`, and Tailscale `status --json` (only `BackendState` is inspected; peer/device data is discarded). The auth subprocess receives no credential-like environment variables. For Codex and GitHub, if their documented environment credential variables are present, the detector explicitly reports that it checked only stored CLI authentication; it does not pass those values to probes, infer readiness from their presence, or return them. Claude Code and Antigravity auth remain `unknown`: no supported noninteractive status contract is established here. Tailscale JSON is upstream-described as subject to change; unknown values or malformed JSON remain unknown. These checks are not a claim that the tool can successfully perform every DevMoter operation.

The web view is opened at `/?setup=1`. All Install and Connect actions are visibly marked Planned and are not actionable. This phase is not a completed Installer v2 and has not passed real-device release smoke.

Upstream status references checked on 2026-09-23:
- [Codex CLI developer commands](https://developers.openai.com/codex/cli/reference/) documents `codex login status`.
- [OpenCode provider docs](https://opencode.ai/docs/providers) documents `opencode auth list` and its provider-specific nature.
- [GitHub CLI `gh auth status`](https://cli.github.com/manual/gh_auth_status) documents its host-specific auth result and exit status.
- [Tailscale CLI reference](https://tailscale.com/docs/reference/tailscale-cli) documents machine-readable status and warns that the JSON format may change.
- [Claude Code setup docs](https://code.claude.com/docs/en/getting-started) documents `claude doctor` as installation/update diagnostics, not a machine-readable authentication status API.
- [Antigravity CLI install and auth docs](https://antigravity.google/docs/cli/install) describe keyring-backed and interactive authentication, not a read-only noninteractive auth-status command.

## 24. Phase 2 install plan preview contract

Phase 2 extends the Phase 1 dashboard only through tool selection, a declarative plan preview, and a human review screen. The preview is not an installer, approval token, or executable plan: every response has `mode: "preview-only"` and `executable: false`. No package manager, installer, downloader, shell, login flow, sudo path, Tailscale mutation, or service operation is invoked.

Each server-owned adapter declares `installSupport`, `installSourceClass` (`A`, `B`, `C`, or `D`), `requiresPrivilege`, `installStatus`, source display metadata, changes, verification, and notes. The browser receives only display metadata and selects a known `toolId` plus `action` (`install`, `keep`, or `manual_review`). It never submits or receives executable paths, argv, package names, installer URLs, cwd, environment maps, or shell text. Extra fields are rejected. Plans are built in adapter order, contain no timestamp or random plan ID, and are identical for the same detected states and selections.

Source classes A/B can be reviewable candidates when the adapter marks the current route supported. Class C can be previewed only as `confirmation-required` and is never a default selection. Class D and unsupported/blocked sources cannot become automatic candidates. Existing installed/ready/auth-required tools are normalized to `keep` even if a stale client asks for `install`; broken or unknown state becomes manual review; unsupported platform cannot install. OpenCode package/protocol compatibility, and GitHub/Tailscale distribution selection, remain manual review until future phases can verify those details. Existing Tailscale login/Serve configuration is explicitly outside the plan and must remain untouched.

`POST /api/setup/plan` follows the existing owner auth, exact-Origin mutation boundary, optional passkey gate, and loopback peer/Host requirements. It accepts only bounded JSON containing selections, rescans server state, validates exact fixed enums and known IDs, rejects duplicate and command-shaped input, and returns sanitized plan data. It has no execution capability. The Setup Wizard uses checkboxes and a review screen with Back; there is no Install button in this phase.

Current install source decisions were checked against official sources on 2026-09-23:
- [OpenAI Codex CLI getting started](https://help.openai.com/en/articles/11096431) documents the official npm distribution. Its plan is a user-prefix Class A candidate and never uses sudo.
- [OpenCode v2 CLI installation](https://opencode.ai/v2/docs) documents an official npm distribution; package/protocol compatibility with the currently detected CLI still requires manual review.
- [Claude Code setup](https://code.claude.com/docs/en/getting-started) documents its official native installer (Class C), whose use requires explicit confirmation in a later install phase.
- [Antigravity CLI installation](https://antigravity.google/docs/cli-install) documents the official Linux/macOS installer script (Class C), and installer flags for avoiding shell-profile edits. Later implementation must review/avoid those side effects before execution.
- [GitHub CLI Linux installation](https://github.com/cli/cli/blob/trunk/docs/install_linux.md) documents maintainer-supported Linux distribution packages (Class A); this phase does not yet identify a matching distro source.
- [Tailscale Linux installation](https://tailscale.com/docs/install/linux) documents signed distribution packages as an alternative to its official bootstrap script (Class A). A later phase must identify the distribution and preserve existing daemon, login, and Serve configuration.

These definitions are display-only reviewed metadata. Phase 2 does not perform package-manager or installer actions; distribution support and exact install commands must be revalidated when a future install executor is designed.


## 25. Phase 2.5 limited execution contract

The first automatic executor remains deliberately narrow. Only Codex and OpenCode are eligible, and only through server-owned official npm package identities. The browser never supplies a package name, executable, argv, cwd, environment map, installer URL, or shell text.

Before execution, DevMoter resolves the local npm executable, reads the configured global prefix, canonicalizes both HOME and the prefix, requires the prefix to remain inside the current user's HOME, and requires it to be writable without sudo. Installation uses fixed argv with `shell: false`. After npm returns success, DevMoter verifies the expected binary from the same prefix before reporting success.

If npm is unavailable, the prefix is outside HOME, the prefix is not writable, installation fails, or verification fails, execution fails closed and returns only a bounded public status. Child stdout/stderr and resolved host paths are not returned.

Claude Code, Antigravity, GitHub CLI, Tailscale, provider authentication, privilege brokering, service installation, and Tailscale Serve remain manual/out of scope. A plan snapshot transitions `pending -> executing -> completed`; concurrent execution of the same plan is rejected to prevent duplicate installers.
