# Large-file inventory (#357)

Date: 2026-11-20. Base: `main` after #639. The line counts come from `wc -l`. The function counts are top-level and nested `function` declarations (`grep -cE '^\s*(export )?(async )?function '`); arrow functions are not counted.

The scope is hand-written source over ~950 lines in `src/`, `server/` and `server.mjs`. Locale dictionaries (`src/locales/*.mjs`, ~2,640 lines each) are data, not logic, and are excluded.

## Generated code (no refactor)

| File | Lines | Note |
|---|---|---|
| `server/office/engine.mjs` | 23,629 | Built by `scripts/build-office-engine.mjs` from pinned GenOffice sources (`vendor/genoffice/NOTICE.md`). Change the vendor sources, never this file. |

## Hand-written files

| File | Lines | Functions | Main responsibilities | Split candidates / issue |
|---|---|---|---|---|
| `src/opencode.ts` | 4,145 | 124 | OpenCode surface: overlay/sidebar/modal focus, model picker and pricing labels, session list, transcript rendering (assistant text, tool parts, reasoning, live streams), SSE connection and resume, permissions/questions, attachments, composer, execution state | transcript renderer, live-stream state, session/sidebar, model picker → #360; HTTP helpers (`api`, `devmoterApi`) → #368 |
| `server.mjs` | 4,082 | 95 | Composition root and **all HTTP routes** (98 `pathname ===` checks: `/api/dev*` 15, `/api/auth*` 12, `/api/control*` 11, `/api/safety*` 8, …), JSON/redaction helpers, project registry and Markdown files, Git/GitHub endpoints, OpenCode proxy/SSE, control tasks (`executeControlTaskCore`), multi-API chat | route modules per prefix → #369; redaction/JSON helpers → #366; project registry → its own module |
| `src/codex.ts` | 3,809 | 94 | Codex surface: JSON-RPC bridge (`rpc`), model catalog and reasoning picker, project selection, thread list/history load and restore, message rendering and MCP tool results, send/interrupt and failure bookkeeping, skills, overlay focus | thread/history data → #362; renderer → #359; model picker shared with OpenCode → #364 |
| `src/settings.ts` | 1,496 | 49 | Settings pages: appearance/theme/density, language, account and sessions, devices, Vault, push notifications, diagnostics and host guide, GitHub link | account/session/device UI → #363; per-page render functions → own modules |
| `src/control-center.ts` | 1,476 | 46 | Control center panel: terminal sessions and authorization, trusted-device section gates, inert/focus handling, project options | terminal client (`terminalFetch`, records) → #368; section gates → shared module |
| `src/api-chat.ts` | 1,430 | 41 | API Chat surface: provider catalog, conversations and history, attachments, send/stop, Markdown | conversation store → #362; provider interface → #364; module split → #361 |
| `server/dev-workflows.mjs` | 1,297 | 46 | Dev workflow service behind `/api/dev*`: settings normalization, MCP servers, extension manifests/approval, project skills/rules, Git info, agent review/CI/repair, ACP probe | settings schema → #367; MCP/extension handling → own module |
| `server/terminal.mjs` | 1,043 | 41 | PTY terminal sessions, WebSocket I/O, replay | already one responsibility; no split needed |
| `src/office-editor.ts` | 988 | 2 | Office/Docs editor UI over the generated engine | already one responsibility |
| `src/workflow.ts` | 980 | 28 | Task workflow screen: tasks, worktrees, diff review by file/hunk, PR preview | already one responsibility |

The large stylesheets are a separate track for #355 (design tokens):

| File | Lines |
|---|---|
| `src/styles/tools.css` | 2,294 |
| `src/styles/workspace.css` | 2,050 |
| `src/styles/base.css` | 1,542 |
| `src/styles/chat-extras.css` | 1,277 |

## Observations

- `src/opencode.ts` and `src/codex.ts` duplicate the same overlay/focus helpers: `syncOverlayState`, `openModal`/`closeModal`, `openSidebar`/`closeSidebar`, `showToast`, `executionLabel`/`setExecutionState`, `trimTranscript` and `escapeHtml`. These are the lowest-risk first extraction and a prerequisite for #358.
- `server.mjs` keeps every route in one `if` chain, so the per-prefix counts above show where a split pays off first: `/api/dev*`, `/api/auth*`, `/api/control*`.
- There are no circular relative imports today (checked by the #370 test in PR #655), so any of these splits can start from an acyclic graph.

## How to refresh

```bash
find src server server.mjs \( -name '*.ts' -o -name '*.mjs' -o -name '*.css' \) -not -path 'src/locales/*' \
  | xargs wc -l | sort -rn | head -16
grep -cE '^\s*(export )?(async )?function ' src/opencode.ts src/codex.ts server.mjs
grep -oE 'pathname === "/api/[a-z-]+' server.mjs | sort | uniq -c | sort -rn
```
