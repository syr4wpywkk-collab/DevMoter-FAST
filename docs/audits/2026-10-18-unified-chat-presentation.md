# Unified Workspace UI — Stage 2: native chat presentation (2026-10-18)

## Scope

Extend the opt-in `?unifiedUI=1` Stitch × ZCode-inspired palette from navigation to the **actual chat transcript and prompt composer** of Codex, OpenCode and API Chat. This is a shared design system, **not** a new message/session renderer or provider protocol.

## Implementation

- `src/unified-workspace-chat.css`: one guarded presentation layer for all three providers. Dark/cyan tokens, light mode, headings, transcript, user/assistant messages, Markdown/code/table treatment, prompt composer, model/agent controls, focus and disabled send states.
- `src/unified-workspace-nav.ts`: load CSS from the already gated navigation chunk. Normal UI is unaffected.
- `test/unified-workspace-chat.test.mjs`: CSS syntax, feature-gate, native input/permission ownership checks.
- `test/unified-workspace-nav.test.mjs`: omit both CSS imports in its JSDOM-only dynamic test harness.

### Boundaries preserved

- Native `cxPromptForm`/`ocxPromptForm`/`apiForm` and their submit/stop/textarea controls are not recreated, hidden or intercepted.
- No changes to history/session IDs, streaming, reconnect, approvals, permission questions, attachments, API credentials or authorization.
- Each provider retains its own dynamic composer height and transcript bottom padding.
- Stop buttons remain distinguishable from send; disabled, focus and status remain explicit. No fabricated messages or run metrics.

## Validation gates

1. Run CI: npm ci, typecheck, lint, build, test, coverage.
2. Run Security Audit and CodeQL on the final PR head.
3. **Real Chromebook/browser/iPhone smoke checks are still required** at 375, 390, 430, 768, and 1366px:
   - virtual keyboard, bottom nav, input and approval overlap;
   - send/stop during real streaming; scrolling long transcripts;
   - Markdown/code tables; image/file attachments and model pickers;
   - OpenCode questions, permission prompts, modal overlays;
   - switching provider, histories, Back/Forward, light/dark theme.

## Activation / rollback

- Test: `http://localhost:8787/?surface=opencode&unifiedUI=1` (substitute private HTTPS origin for iPhone).
- Rollback: remove `unifiedUI=1` and reload.
- Full shared chat renderer/adapters are **still out of scope** pending real-device tests.
