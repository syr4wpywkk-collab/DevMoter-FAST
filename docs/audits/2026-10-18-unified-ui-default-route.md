# DevMoter FAST — Unified UI default on the existing URL (2026-10-18)

## User intent
The user requested that the already-implemented Unified Workspace be the normal UI:
**no new Tailscale domain or ?unifiedUI=1 required**.

## Change
- `src/unified-ui-mode.mjs`: return true for bare, existing `?surface=...`,
  and legacy `?backend=...&session=...` URLs. Opt-out is only `?unifiedUI=0`.
- `src/app-shell.ts`: after the existing shell mounts, dynamically import
  the Unified Workspace by default. Preserve `?unifiedUI=1` for existing links.
  Do not redirect, navigate, mutate location, replace provider roots or
  modify any user setting.
- Catch dynamic import or mount failures, remove any partially mounted unified
  nav/body class and restore static native provider history labels. Keep the
  legacy app/shell available and show an explicit fallback notification.
- Tests cover default routes, opt-out, URL immutability, dynamic import fallback
  and provider composer preservation.

## Important uncertainty
A white screen on the user's iPhone/Tailscale is **not diagnosed** by
changing the query flag. The app may fail earlier (JS bootstrap), at the
HTTP/Tailscale layer, or due to stale PWA assets; these failures would not be
covered by a dynamic-import fallback inside `mountUnifiedFeatureShell`.
Do not claim a verified fix until the user can open the URL on real hardware.

## Verification and rollout gates
- CI must pass typecheck, lint, unit tests, coverage and build; Security Audit
  and CodeQL on the final PR SHA.
- Normal local/Tailscale URL: no UI flag. `?unifiedUI=1` remains backward compatible.
- Emergency rollback for a broken new UI: `?unifiedUI=0`.
- Real device tests: bare base URL, ?surface=codex, OpenCode/API Chat,
  switching providers, history, composer, permissions, Safari reload, PWA
  reopen, sidebars and mobile keyboard.
- Never change the Tailscale hostname, login, session history or stored secrets.
