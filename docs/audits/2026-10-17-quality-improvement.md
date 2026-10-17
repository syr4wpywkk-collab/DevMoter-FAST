# DevMoter FAST quality improvement log — 2026-10-17

## Scope and repository state

- Workspace: `/workspace/DevMoter-FAST` (the user-provided absolute path was unavailable in this execution environment).
- Branch: `work`; HEAD and fetched `origin/main`: `0408eb1d2f6af3f81d379cc3ede2ee48df248b45` (#315). Initial worktree was clean. No product code changes were present.
- The initial `git fetch origin --prune` updated `origin/main` to the current HEAD. No user changes were overwritten.
- GitHub GraphQL access returned `Forbidden` for PR/Issue queries; PR #313, issue details, CI runs, and required-check configuration could not be verified remotely.
- The directory does not have Chromium/browser automation availability established by this review; no mobile viewport screenshots or iPhone/device test were performed.

## Baseline evidence and scores

Scores are engineering estimates based on code/tests/docs in this checkout, not production telemetry. Reliability/security/testability estimates have high confidence from focused automated tests; usability/performance estimates are lower confidence because no real devices or performance traces were available.

| Axis | Before | Evidence / uncertainty |
| --- | ---: | --- |
| Reliability | 3.5/5 | 576 tests later pass; startup parity and real upstream/device behavior remain manual in `RELEASE_SMOKE.md`. |
| Security | 4/5 | `npm run security:audit` passes 72 checks; auth/OIDC/passkey, origin, path and approval tests exist. Not a full external penetration or dependency-service assessment. |
| Usability | 3/5 | Mobile/browser regression tests cover navigation, viewport, focus and contrast selectors; no actual iPhone or viewport screenshot comparison. |
| Maintainability | 2.5/5 | `server.mjs` aggregates many route families and imports; bundle warning indicates broad frontend entry. Estimate based on structure, not change-time study. |
| Performance | 2.5/5 | Build succeeds but main JS is 777.89 kB minified / 234.33 kB gzip, above Vite's 500 kB warning threshold. No device timing/memory trace. |
| Testability | 4/5 | 576 automated tests, integration harnesses and coverage command; Vite dep-scan shutdown diagnostics appear in concurrent test fixtures. CI exact-commit result not remotely verifiable. |

## Confirmed findings (prioritized)

1. **P2 documentation correctness:** `ROADMAP.md` called Google/Microsoft sign-in planned while README said available. `server/oidc-auth.mjs`, `server.mjs`, `docs/auth-v2.md`, and `test/oidc-auth.test.mjs` confirm OIDC+PKCE login/link implementation and validation. Fixed roadmap and translated README status; real OAuth credentials/provider deployment remain host-specific.
2. **P2 release checklist correctness:** `RELEASE_SMOKE.md` referred to nonexistent `scripts/start-devmoter.sh`. Repository contains `scripts/start-pocket.sh`; corrected the checklist. This is only the launcher script name; checks continue to require `devmoter-fast.service`, with no legacy service instruction.
3. **P2 release checklist formatting:** Four installer checks had literal `\n` text embedded in one bullet, preventing normal checklist rendering. Split them into four items.
4. **P2 documentation consistency:** README product track `v2.0.0-alpha` and package version `0.2.0` were unexplained. Clarified in English/Japanese/Chinese that the former is release maturity and the latter is the npm package version.
5. **P2 / issue #333 candidate, remote verification unavailable:** CI workflow contains `npm ci`, typecheck, lint, build, tests, and coverage, but a workflow definition is not evidence of successful runs or branch protection. GitHub API was forbidden; no claim of CI/required-check completion is made.
6. **P2 mobile validation gap:** target sizes 320/375/390/768/1280 and real iPhone checks have not been run in this environment. Existing regression source tests include mobile navigation, visual viewport, keyboard/modal/focus and theme checks; this does not establish real-device behavior.
7. **P2 frontend bundle size:** production build emits 777.89 kB main JS (234.33 kB gzip), generating Vite's >500 kB warning. No code splitting was attempted because it is a separate, wider performance change.
8. **P2 concurrency diagnostic:** concurrent `npm test` / `npm run test:coverage` runs logged Vite/esbuild dep-scan “server is being restarted or closed” diagnostics from lifecycle-managed test fixtures. Both commands exited 0; worth isolating if it recurs in CI.
9. **P2 external integration validation:** Codex/OpenCode live-runtime operations and Google/Microsoft actual provider callbacks require host credentials/services; local mocks/contracts do not prove deployment compatibility.
10. **P3 performance evidence gap:** no mobile CPU/memory, network waterfall, or startup latency measurements available; ratings should be revisited with browser/device profiling.
11. **P3 runtime test skip:** one real tmux persistence test was skipped by its environment guard; other terminal tests passed.
12. **P3 repository/CI policy evidence:** no GitHub issue/PR state, CI success state, or required status-check configuration could be observed from this environment.

## Improvement cycles

### Cycle 1 — Documentation and release checklist integrity

- Issue: documentation inconsistency / release checklist errors; issue number could not be established due unavailable GitHub API.
- Cause: stale roadmap and localized README capability labels; incorrect launcher path and escaped newline text in checklist.
- Changes: `README.md`, `README.ja.md`, `README.zh-CN.md`, `ROADMAP.md`, `RELEASE_SMOKE.md`.
- Tests: auth source/tests reviewed; OIDC tests passed in test suite; `git diff --check` passed; final typecheck/lint/security audit passed. No dedicated docs test exists.
- Risk: documentation describes OAuth availability conditional on host setup; actual provider credentials were not used.
- Next: validate PR #313 and issues #316–#395 when GitHub access exists; run required-check/branch-protection inspection; obtain real-device and upstream-backend smoke.
- Commit SHA: not committed; awaiting normal review/PR handling.

## Validation record

- `npm run typecheck`: pass (baseline and final).
- `npm run lint`: pass, 282 source files (baseline and final).
- `npm test`: exit 0; 576 tests, 575 pass, 0 fail, 1 skipped; duration about 151 seconds.
- `npm run test:coverage`: exit 0; coverage report generated; one environment-guarded tmux test skipped. Aggregate percentages were truncated in captured terminal output; report artifact exists under `coverage/` but was not copied into this log.
- `npm run build`: pass. Vite warns that main JS exceeds 500 kB (777.89 kB minified, 234.33 kB gzip).
- `npm run security:audit`: pass, 72 checks.
- `npm ci`: not run; existing locked dependencies and node_modules were present. No dependency install was needed for these documentation changes.
- GitHub CI/PR/issue details, `npm audit` workflow step, branch protection, real systemd service, real Codex/OpenCode servers, external OAuth, viewport screenshots and iPhone test: not run/unavailable.
- No production service was restarted, no deployment or external data operation was performed, and no secrets were printed.

## End state / restart handoff

- Branch `work`; documentation changes are uncommitted and isolated to the five files listed above; there were no initial user modifications.
- No application code changed. Review the five-file diff before creating a small documentation PR.
- Highest remaining priorities: obtain GitHub read access to inspect PR #313 and issues #316–#395; inspect exact CI/check protections; profile/split frontend bundle; test 320/375/390/768/1280 and actual iPhone; perform host-specific OAuth and Codex/OpenCode/systemd smoke.

### Cycle 2 — Concurrent conversation-history refresh

- Finding: overlapping Codex `thread/list` and OpenCode `/session` refreshes were applied in completion order. A slower older response could replace the newer history snapshot after the user had already received a newer refresh.
- Cause: both `loadThreads()` and `loadSessions()` assigned any successful response without tracking request order.
- Changes: added `src/latest-request.mjs` and declaration; both history loaders ignore stale generations; added `test/latest-request.test.mjs` (2 tests: guard semantics and wiring-before-assignment).
- Before/after: before, response arrival order controlled the displayed list; after, only the latest-started refresh may update it. Failed list requests still do not assign an empty list because assignment follows successful fetch/parse.
- Validation: initial typecheck caught a missing `.d.mts` declaration; fixed. `npm run typecheck` passed; `node --test test/latest-request.test.mjs` passed 2/2; `git diff --check` passed.
- Review/risk: this protects list snapshots, not asynchronous active-session probes or content loads; errors still follow existing caller behavior. The test asserts shared helper and source integration, not a full dual-refresh DOM race.
- Next: inspect OpenCode-to-Codex/API/Home navigation behavior and test lifecycle restoration paths. Continue with API timeout/error handling if no navigation defect is found.
- Commit SHA: pending.

### Cycle 4 — Resume after history synchronization failure

- Finding: background/online resume disconnected the event stream, then awaited full refresh, then reconnected. A failed refresh skipped event reconnection. OpenCode had already set its visible execution state to `reconnecting` and did not clear it on this path.
- Cause: refresh and stream reconnection were sequential without `finally` protection or a surfaced sync error.
- Changes: added `src/reconnect-after-sync.mjs` (+ declaration), wired Codex/OpenCode resume paths to always reconnect in `finally`, added user-facing sync failure messaging and OpenCode state recovery; added 3 tests.
- Before/after: before, rejected history refresh could leave the event stream closed indefinitely; after, event reconnection is attempted on both success and failure, while failure is explicit.
- Validation: `npm run typecheck` pass; `node --test test/reconnect-after-sync.test.mjs` 3/3 pass; `git diff --check` pass.
- Review/risk: event source reconnect may itself fail and relies on existing bounded retry logic. Sync error behavior is covered via helper tests and wiring assertions, not full browser lifecycle automation.
- Next: inspect API timeout/error handling and cancellation; add a focused runtime regression where supported.
- Commit SHA: pending.

### Cycle 5 — API Chat request timeout and recovery

- Finding: API Chat had no request deadline. A provider/network request that never settled kept the composer disabled with an indefinite waiting state.
- Cause: request cancellation existed for conversation changes, but no timeout distinguished a hung provider request from deliberate cancellation.
- Changes: `src/api-chat.ts` now aborts chat requests after 120 seconds, shows a localized timeout error while preserving the submitted prompt/message, and restores send controls. `test/api-chat-conversations.test.mjs` adds a deterministic abort-timeout case.
- Before/after: before, wait could continue indefinitely; after, request is aborted at 120s, error is visible, prompt remains in history, and send is enabled. No automatic retry is performed.
- Validation: typecheck passed; API Chat conversation tests 5/5 passed; lint checked 288 files; `git diff --check` passed.
- Review/risk: timeout is fixed at 120s; a legitimate provider operation longer than that is cancelled at transport level. As with any client timeout, server/provider work may have completed even if the response was lost; user must decide whether to retry.
- Next: review mobile composer/viewport and touch interactions, then model catalog stale-state/fallback behavior.
- Commit SHA: pending.

### Cycle 7 — Model/provider catalog refresh ordering

- Finding: Codex model catalog and OpenCode provider/model catalog were also overwritten by any response completion, so overlapping refreshes could restore a stale catalog and stale selection metadata.
- Cause: catalog requests had no generation guard.
- Changes: reused latest-request guards in `src/codex.ts` and `src/opencode.ts`; extended `test/latest-request.test.mjs` to assert both catalog guards execute before state assignment.
- Before/after: before, old catalog responses could win by arriving last; after, only the latest-started catalog refresh mutates catalog state.
- Validation: typecheck passed; latest-request tests 2/2 passed; diff check passed.
- Review/risk: network failure still preserves last known catalog by existing semantics; no pricing is inferred or changed. Runtime race integration uses source wiring assertion plus directly tested helper.
- Next: inspect server/API boundaries for reproducible permission gaps and add high-value negative tests. Mobile real-device inspection remains unavailable; source CSS constraints already enforce 44px controls and viewport sizing.
- Commit SHA: pending.

### Cycle 3 — OpenCode surface navigation regression coverage

- Finding: implementation inspection found OpenCode navigation is owned by the unified global shell and browser history (`src/main.ts`, `src/surface-navigation.mjs`), but automated behavior coverage exercised only Home↔one backend, not the full OpenCode→Codex→API Chat→Home path.
- Cause: the existing navigation test did not cover all supported surface transitions together.
- Changes: added a browser-history regression in `test/surface-navigation.test.mjs` checking OpenCode→Codex→API→Home, Back navigation, and query/hash preservation.
- Before/after: before, the transition chain was untested; after, all transitions and reverse navigation are exercised. No runtime defect was observed, so no production code was changed.
- Validation: surface navigation tests 6/6 passed; diff check passed.
- Review/risk: fake History API validates controller behavior, not real browser rendering or manual shell click targets.
- Next: resume API timeout/error work and security test review.
- Commit SHA: pending.

### Cycle 8 — API Chat provider refresh outage

- Finding: refreshing providers during a temporary server/network failure cleared provider and model choices from the UI.
- Cause: `refresh()` replaced the cached catalog with empty arrays in its error handler; stale provider state had no explicit availability gate.
- Changes: `src/api-chat.ts` retains the last displayed provider/model selection after refresh failure, marks the catalog unavailable, and blocks chat submission until refresh succeeds. `test/api-chat-conversations.test.mjs` covers outage, preserved selection, disabled send, and successful retry.
- Before/after: before, transient outage erased displayed configuration; after, configuration remains inspectable while sending stays fail-closed until a successful refresh.
- Validation: typecheck passed; API Chat tests 6/6 passed; lint passed (288 files); diff check passed.
- Review/risk: a failed refresh still disables sending even where a previously configured backend might remain usable; this is intentional to avoid relying on stale model/provider authorization metadata.
- Next: security-boundary regression tests and final quality gates.
- Commit SHA: pending.

### Cycle 9 — Reject oversized idempotency keys

- Finding: `x-pocket-operation-id` was silently truncated to 160 characters, making distinct caller-supplied IDs with the same prefix collide and suppress a legitimate operation.
- Cause: server parsing clipped input instead of validating the maximum length.
- Changes: `server/operation-registry.mjs` exports bounded `normalizeOperationId`; `server.mjs` now returns HTTP 400 for IDs longer than 160 rather than truncating; added unit and authenticated HTTP integration coverage.
- Before/after: before, distinct long IDs shared one effective key; after, oversized IDs fail before the mutation route and valid IDs preserve their exact identity.
- Validation: typecheck passed; operation-registry + auth server integration tests 5/5 passed; diff check passed.
- Review/risk: this hardens idempotency key identity and bounded input; it does not replace route authorization or guarantee exactly-once upstream behavior.
- Next: add a deeper test of duplicate protected mutation delivery, then run grouped and final quality gates.
- Commit SHA: pending.

### Cycle 10 — Duplicate mutation delivery integration coverage

- Finding: operation registry unit tests established scope and TTL behavior, but the authenticated HTTP integration test did not prove duplicate operation IDs are rejected before the route executes.
- Cause: no end-to-end regression case for the server's `claimOperation` boundary.
- Changes: `test/auth-server.integration.test.mjs` now repeats the same authenticated, same-origin Integration Status operation ID and asserts HTTP 409 with `outcome: unknown`.
- Before/after: before, duplicate suppression was only unit-tested; after, the real local HTTP server/auth/origin/route pipeline is covered.
- Validation: auth server integration tests 2/2 passed; diff check passed.
- Review/risk: endpoint is read-only and test-local; this does not establish exactly-once semantics beyond the operation registry TTL/capacity.
- Next: run the full final quality gate sequentially; inspect build warnings and all committed diffs.
- Commit SHA: pending.

### Cycle 11 — Keep OpenCode DOM test harness aligned with imported modules

- Finding: first final full-suite run failed three OpenCode Markdown tests before assertions because their isolated module loader rejected the newly added shared helper imports.
- Cause: the test harness used a hand-maintained module map and did not register `latest-request.mjs` and `reconnect-after-sync.mjs`.
- Changes: `test/opencode-markdown.test.mjs` now loads and registers both helper modules.
- Before/after: before, three tests failed during harness initialization; after, the focused OpenCode Markdown suite passes 3/3.
- Validation: focused tests pass; full suite is being rerun after this fix.
- Review/risk: no production code changed; continue to verify every isolated OpenCode harness in the full suite.
- Next: sequential final gate.
- Commit SHA: pending.
