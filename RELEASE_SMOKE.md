# Release smoke checklist

Automated CI is necessary, but it does not prove that upstream agents, systemd, Chromebook/Crostini, or iPhone behavior works. Run this checklist before a tagged release or when promoting an Experimental surface to Shipped.

## Automated gate

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] CI is green on the exact candidate commit

## Startup parity

- [ ] `scripts/start-pocket.sh` reaches healthy state
- [ ] `devmoter-fast.service` reaches the same healthy state
- [ ] service restart does not loop
- [ ] DevMoter binds to localhost by default
- [ ] OpenCode is not exposed directly
- [ ] `/api/health` reports understandable backend state
- [ ] Tailscale Serve, if used, points only to DevMoter

## Authentication and boundary smoke

- [ ] unauthenticated API requests are rejected
- [ ] unauthenticated event/stream requests are rejected
- [ ] mutation with missing/mismatched Origin is rejected
- [ ] valid authenticated same-origin mutation succeeds
- [ ] registered project boundary rejects path escape
- [ ] secrets do not appear in normal browser API responses

## OpenCode real-runtime smoke

- [ ] create/resume session
- [ ] select agent/mode/model
- [ ] send prompt and receive streaming output
- [ ] tool/reasoning state remains readable
- [ ] exercise permission/question flow
- [ ] interrupt an active run
- [ ] reload/reconnect reconciles state without duplicate mutation

## Codex real-runtime smoke

- [ ] create/resume/fork thread
- [ ] model picker reflects app-server-advertised models
- [ ] reasoning picker reflects selected model metadata
- [ ] explicit reasoning effort reaches a real turn
- [ ] Auto works without forcing an unsupported effort
- [ ] send prompt and receive streaming output
- [ ] approval flow works
- [ ] image/file attachment works
- [ ] plugin/MCP names/status are meaningful
- [ ] Usage view either returns real supported data or clearly reports unavailable; no synthetic quota claim
- [ ] interrupt an active turn

## Projects / GitHub / reviewed changes

- [ ] switch projects without arbitrary cwd injection
- [ ] Markdown read/write stays inside registered project
- [ ] GitHub picker opens a managed repository without discarding local changes
- [ ] reviewed proposal can be inspected and applied
- [ ] context drift blocks stale apply
- [ ] unrelated dirty changes block unsafe commit
- [ ] worktree/PR flow uses the selected repository/branch

## Experimental surfaces

For every Experimental feature mentioned in release notes:
- [ ] API Chat uses a real configured provider without returning stored API key to frontend
- [ ] host integrations report missing/unsupported executables clearly
- [ ] automation trigger/schedule stays inside intended project/host boundary
- [ ] device/passkey controls have a tested recovery path

Do not promote a surface to Shipped solely because its UI renders.

## Mobile smoke

On the target iPhone/mobile browser:
- [ ] navigation and composer fit without inaccessible controls
- [ ] long transcript/tool output remains scrollable/copyable
- [ ] keyboard open/close does not strand the composer
- [ ] background/foreground reconnect is understandable
- [ ] PWA launch works when installed

## Failure paths

- [ ] stop OpenCode; Codex surface remains understandable
- [ ] stop/crash Codex; OpenCode remains understandable
- [ ] restore each backend and confirm recovery
- [ ] interrupt network during mutation; no blind replay
- [ ] unsupported upstream response produces an explicit error rather than fake success

Record commit, OS, Node, OpenCode, Codex, browser and device versions with release notes.

## Installer v2 foundation (Experimental)

- [ ] Open `/?setup=1` from the local DevMoter URL and confirm the environment and six tool rows render; confirm Rescan can be repeated.
- [ ] Confirm missing tools, unsupported auth status, and broken version checks are shown without raw command output or executable paths.
- [ ] Select a missing supported tool and confirm Review shows only server-owned source class, privilege, changes, verification, and notes.
- [ ] Confirm installed/ready tools say Keep existing; broken and unsupported tools cannot be planned for install.
- [ ] Confirm Class C is not silently selected and manual-review metadata stays blocked from execution.
- [ ] Confirm unauthenticated, cross-origin, non-loopback, malformed, and oversized setup requests fail closed.
- [ ] With a user-owned writable npm global prefix, confirm a reviewed missing Codex/OpenCode candidate installs only its fixed official npm package and verifies the expected CLI binary.\n- [ ] Confirm a system/global or non-writable npm prefix fails closed with `needs_user_action`.\n- [ ] Confirm Claude, Antigravity, GitHub CLI and Tailscale remain manual; no sudo, arbitrary downloader, login, service, or Tailscale mutation runs.\n- [ ] Double-submit one plan and confirm only one execution proceeds.
