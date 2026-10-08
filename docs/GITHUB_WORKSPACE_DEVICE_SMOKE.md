# GitHub workspace picker — real-device acceptance (#13)

The implementation is on `main` (including the default-branch freshness
fix from PR #208). Issue #13 explicitly requires **real Chromebook + iPhone
validation before closure**. This checklist is the remaining acceptance gate;
simulated tests, CI and screenshots are not substitutes for that gate.

## Preflight (owner's devices only)

- Run the latest `main` build and restart `devmoter-fast.service`.
- On the Chromebook, verify `gh --version` and `gh auth status` locally.
  Never copy authentication tokens, session cookies or private repository
  metadata into issues or screenshots.
- Have one disposable GitHub repository with a spare branch available.
  Do not test destructive edge cases on an active project.
- Confirm the normal authenticated DevMoter route works on the Chromebook
  and on the iPhone through the existing private network boundary.
  Do not open DevMoter's setup API to the public internet.

## Owner-operated smoke matrix

Record PASS / FAIL, device, date and a **redacted** note for each item.

| ID | Device | Action | Expected result |
| --- | --- | --- | --- |
| GH-01 | Chromebook | Sign out of host `gh` (using a disposable host/session) or use a separate unauthed test environment; open Projects → GitHub | The UI explains missing/unauthenticated GitHub CLI without leaking credentials or disabling other Projects |
| GH-02 | iPhone | With the host authenticated, open Projects → GitHub and search a repository name | Accessible repositories appear with correct private/public metadata; search and loading/error states work |
| GH-03 | iPhone | Open a repository not yet in the managed local root | The selected repo is cloned to the fixed managed root and registered as a normal Project |
| GH-04 | iPhone | Select a non-default disposable branch, then reopen the same repo | The intended branch is selected; the existing clone is reused rather than overwritten |
| GH-05 | Chromebook + iPhone | Change the disposable repository's GitHub default branch between initial search and branch selection | The picker uses fresh branch-endpoint default metadata, not stale search result metadata |
| GH-06 | Chromebook | Add an uncommitted harmless change in the disposable clone, then request an incompatible switch from the iPhone | The switch is blocked without discarding the local change |
| GH-07 | iPhone | Open the chosen GitHub Project in Codex; start a **new** thread | New Codex thread starts in the selected managed Project directory; existing threads keep their original directory |
| GH-08 | iPhone | Open the chosen GitHub Project in OpenCode; start a **new** session | Server resolves the Project ID to the managed directory; no arbitrary client-provided cwd is accepted |
| GH-09 | iPhone | Disconnect/reconnect mobile network during a repository operation; inspect project state afterwards | Operation-ID deduplication and reconciliation avoid unsafe duplicate mutation; user sees a readable error or recovered state |
| GH-10 | Chromebook + iPhone | Return to Local Projects and a previous Codex/OpenCode session | Existing local Projects, resumed sessions and login flows are unchanged |

## Security observations

- For any GitHub API call, verify unauthorized DevMoter users cannot access
  private repo listings. Do not publish private repository names.
- Confirm cloned directory, current branch and Git remote identity using
  **read-only** checks on the Chromebook.
- Do not deliberately change a real clone's remote to test origin mismatch.
  That guard is covered by automated tests; use a disposable fixture if
  manual verification is required.
- Never paste passwords, auth tokens, private URLs or raw terminal output
  with secrets into the Issue.
- If a smoke case fails, record the visible symptom, reproduction sequence
  and a sanitized log; leave #13 open.

## Closure rule

Only close #13 when GH-01 through GH-10 have passed on the designated
Chromebook/iPhone setup, security checks are clean and no high-severity
regression remains. CI passing alone is not completion. This document
records **required testing, not completed testing**.
