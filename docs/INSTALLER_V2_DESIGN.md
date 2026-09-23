# DevMoter FAST Installer v2 — Design

Status: **Design proposal**  
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
