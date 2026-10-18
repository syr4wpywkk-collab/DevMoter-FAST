# Unified UI: deduplicated backend switching and Codex visual parity

Date: 2026-10-18. User screenshots show that the Codex history drawer remains grayscale and that the three-agent chooser is duplicated.

## Fix

- The opt-in Unified Workspace selector (?unifiedUI=1) remains the single Codex / OpenCode / API Chat switcher.
- Hide redundant agent-switch dropdowns in native Codex and API Chat sidebars **only in unified mode**, and the AI backend tile grid in global Tools. Native OpenCode sidebar already contains only a static identity.
- Replace hidden dropdowns with read-only, visible, accessible agent identities. Normal mode retains the original controls, history and permissions.
- Extend shared Codex palette to history drawer, title bar, input, recent threads, search, workspace control panels and modal, replacing hard-coded grayscale when unified mode is active.
- Preserve native OpenCode/API Chat provider + model selectors inside composers; never hide native prompt forms, approvals, history buttons, sessions, streaming or credentials.
- No new API routes or auth/authorization behavior changes.

## Verification

- Independent JSDOM test for unified labels, sole backend selector, correct backend switching and restoration on destroy.
- CSS syntax and source assertions cover providers, native model pickers and Codex shared palette.
- CI: npm test / typecheck / build / lint / coverage.
- Security Audit and CodeQL after final PR commit.
- Actual Chromebook/iPhone browser screenshot and keyboard acceptance remains necessary. Do not claim device visual validation.
- Rollback: remove unifiedUI=1 from URL to restore legacy agent switches.

## Screens to inspect

- Codex, OpenCode, API Chat sidebars in dark and light modes
- History via unified Chat control, no duplication in Tools
- Single selector switches agent without changing within-agent model choice
- Mobile composer, keyboard, permission and approval dialogs