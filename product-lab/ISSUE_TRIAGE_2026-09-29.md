# DevMoter open Issue triage — 2026-09-29

Repository verified: `syr4wpywkk-collab/DevMoter-FAST` (`origin` is `https://github.com/syr4wpywkk-collab/DevMoter-FAST.git`). Current `main` is `a00df071d85bcc60fbe6b7bff60970420239265f`; the checkout already had untracked `.git-worktrees/` and `opencode.jsonc`, which were left untouched.

## Decision

The live GitHub query returned three open issues: #13, #210, and #240. None meets its completion gate, so no issue was closed. The repo's instruction is to keep this round read-only with respect to app implementation, publication/deployment, production data, and secrets; this review changed no application code and made no GitHub Issue state changes.

## Per-issue assessment

| Issue | State | Assessment | Remaining gate |
| --- | --- | --- | --- |
| [#13 GitHub repository picker](https://github.com/syr4wpywkk-collab/DevMoter-FAST/issues/13) | Keep open | The core picker, managed clone/fetch, Project registration, and Codex/OpenCode integration are on `main`; PR #208 fixed the stale default-branch selection. The Issue explicitly requires Chromebook **and** iPhone validation before closing. Existing Issue comments confirm that validation has not been performed. | Record successful Chromebook and iPhone end-to-end checks against the acceptance criteria. |
| [#210 Antigravity launch](https://github.com/syr4wpywkk-collab/DevMoter-FAST/issues/210) | Keep open | PR #265 merged the resolved executable path, preserved Project cwd, safe argument arrays, explicit terminal failures, and contract tests (`test/integration-launch-contracts.test.mjs`). Its own validation note explicitly says the Issue must remain open until Chromebook/Crostini launch is revalidated. CI passed, but no device revalidation record was found. | Verify the Antigravity CLI opens from the selected Project on Chromebook/Crostini, including the relevant service environment, then record the result. |
| [#240 Installer v2 epic](https://github.com/syr4wpywkk-collab/DevMoter-FAST/issues/240) | Keep open | PRs #271/#272 landed the detector, setup wizard, plan/execution foundation, and fixed Codex/OpenCode npm executors. The Issue's latest progress comment explicitly lists remaining auth handoff, privileged package handling, service install/health, Tailscale Serve and verified URL/QR, resumable progress/state, post-install checks, and device smoke. The authoritative design in `docs/INSTALLER_V2_DESIGN.md` describes the broader completion conditions. | Complete the remaining design scope and real-device smoke; update the Issue with evidence before closing. |

## Suggested closeout work

These are proposals for follow-up implementation/validation work. They are not performed in this read-only triage round.

### #13 GitHub repository picker

Run a short end-to-end checklist on both a Chromebook and an iPhone against the current main build: authenticate with host `gh`, search a repo, inspect branches, open a repo, then confirm it is selectable by Codex and OpenCode. Include at least one private repo and one already-cloned repo if available. Record device/browser/OS and app commit, expected/actual result for each step, and any failure with safe-to-share logs. File focused follow-up Issues for any new defects; close #13 only after both device runs pass.

### #210 Antigravity launch

On the Chromebook/Crostini setup from the original reproduction, launch Antigravity via **PCで開く** from a selected Project. Verify the CLI starts (not just the terminal), its working directory is that Project, and the route works in the actual systemd user-service environment. Also confirm a missing terminal/launcher produces a visible error and the existing Remote Control start/stop and QR flow still works. PR #265 already supplies the code-side fix and CI contracts, so only add code if this device run exposes a remaining reproducible defect. Record the device result in #210 before closing.

### #240 Installer v2 epic

Keep the epic open while delivering the missing design scope as small linked Issues/PRs: (1) supported auth handoff/coordinator, (2) fixed and reviewed package adapters plus privilege broker where needed, (3) service install with health verification, (4) conflict-aware Tailscale Serve setup with verified URL/QR, and (5) resumable progress/state plus post-install verification. For each phase, retain server-owned fixed commands and fail-closed behavior, document rollback/re-run behavior, and add contract tests. Finish with clean-install, retry/interruption, upgrade, and real-device smoke evidence. Close the epic only when the design's alpha completion conditions pass together.

## Independent review and synthesis

Three independent read-only audits were run, one per Issue. All recommended keeping the assigned Issue open. The audits agree that code landing or green CI is not sufficient where the Issue explicitly requires real-device validation. #240 is additionally incomplete in core product behavior, while #13 and #210 are primarily waiting on device evidence.

No deletion was attempted: GitHub Issues are triaged by closing when their completion conditions are met, and none of these three is currently closeable on the evidence available.
