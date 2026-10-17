# Unified Workspace UI — staged rollout audit (2026-10-17)

## Scope and evidence
- Base: `main` at `0408eb1d2f6af3f81d379cc3ede2ee48df248b45`.
- Reviewed: `src/main.ts`, `src/app-shell.ts`, `src/app-shell.css`, `src/surface-navigation.mjs`, `src/app-registry.ts`, `src/codex.ts`, `src/opencode.ts`, `src/api-chat.ts`, and `docs/FRONTEND_ARCHITECTURE_V2.md`.
- Design inputs supplied: four Stitch HTMLs (desktop code workspace, desktop AI prompt studio, mobile IDE, mobile GLM chat), plus the user's original offline unified UI reference and its implementation handoff.
- The reference HTML is *only* a local demo. Its tasks, approval cards, logs, data, metrics and AI replies are samples and must not enter production.
- ZCode documentation was consulted for task-first navigation, native project/workspace task lists, conditional inspector/terminal, and permission confirmation patterns. Its source, icons and brands were not copied.

## Findings: ownership before changing UI
| Existing owner | Preserved interface | Reason |
| --- | --- | --- |
| `src/surface-navigation.mjs` | URL surface, pushState / popstate | Keep Back / Forward and deep links canonical |
| `src/main.ts` | Provider mount points and `devmoter:surface-changed` | Avoid remounting or duplicate root ownership |
| `src/codex.ts` | Codex session IDs, streaming, pending approvals | Never unify authority or invent permission state |
| `src/opencode.ts` | OpenCode sessions, agents, model menu, stream recovery | Keep provider-specific event/reconnect logic |
| `src/api-chat.ts` | API provider/model selection and history | Keep real configuration and history |
| `src/app-shell.ts` | AppRegistry `launchApp`, existing sidebar, actions | Reuse real registered feature routes |
| `src/react/` | Existing isolated React ownership | Do not mount React into DOM-owned provider roots |

## Design translation
- **Adopted**: Stitch dark/cyan/nav cards, compact text, consistent 44px controls, focus indication, safe-area-aware bottom navigation; ZCode's task-first grouping and minimal steps to sessions and review.
- **Not adopted**: Z-CODE/GLM branding, third-party images/code, invented token usage and model throughput, demo approvals, fake tasks, permanent file-tree duplication, runtime Tailwind/Fonts CDN, arbitrary execution modes.
- **Stage 1 delivered**: independent `src/unified-workspace-nav.ts` + scoped CSS. Opt in with `?unifiedUI=1` (existing URL surface query remains). Desktop left navigation and mobile Tasks / Chat / Review / Tools are working **entry points**, not fake data views.
- **Backend source of truth**: selecting Codex / OpenCode / API Chat invokes the existing shell's `switchBackend`. The native provider's history button remains the canonical source of session IDs. Tasks opens the real Sessions / Activity app; Review opens the real task workflow; Tools opens the existing shell menu. Home uses the existing navigation callback. No backend/permission APIs added.
- **Fallback**: remove `unifiedUI=1` and reload to use the unchanged legacy view.
- **Important boundary**: the navigation is live but **the inner message/streaming/composer components are not yet unified**. This is deliberately a reviewable first implementation slice, **not** a completed Unified Session Presentation architecture.

## Verification / environment
The two requested repository paths (`/workspace/DevMoter-FAST` and the Chromebook home directory) were unavailable in the execution container; direct Git clone failed because the container could not resolve `github.com`. The connected GitHub API was used to inspect source and make branch commits instead. The uploaded ZIP was read and contained all four required HTML files.

A new JSDOM unit test covers actual action delegation, provider history triggers, source-only project-label rendering (including an HTML-like string), state synchronization and teardown. It runs under the repository's existing Node test runner. **CI results must be checked before merging.** Local `npm ci`, Typecheck, Lint, Test, Coverage, Build, Security and browser screenshots could not be executed against a full working tree in this container; do not mark them as passing here. Device-width and iPhone tests remain pending.

## Next work (gates)
1. Inspect CI and fix any TypeScript/lint/test issues. Browser screenshots at 375 / 390 / 430 / 768 / 1366; ensure chat composer and bottom tab bar do not overlap, keyboard zoom and safe-area behavior.
2. Connect a unified **read-only** task list to actual per-provider session summary APIs with workspace/project boundaries; do not merge session IDs or synthesize statuses.
3. Move API Chat message/composer presentation into one display adapter while preserving API settings, attachments, send and history.
4. Migrate OpenCode, then Codex only after streaming, approvals, reconnect and double-submit regression tests.
5. Add real inspector and log drawer using existing File/Git/Review/Terminal surfaces, then remove duplicate nav controls without changing security ownership.

## Explicitly out of scope / not done
No new authentication, elevated permissions, provider, Office engine, cloud database, fake connectivity or invented metrics; no auto-merge.
