# DevMoter FAST roadmap

DevMoter FAST is evolving from a mobile remote UI into a **self-hosted control plane for coding agents**. This roadmap describes maturity gates, not promises or release dates.

## Status vocabulary

- **Shipped** — wired to a real backend path and part of the supported product surface.
- **Experimental** — implemented, but still receiving contract, device, security, or UX hardening.
- **Planned** — design/roadmap work; must not be presented as a shipped capability.

## Now — make the control plane boringly reliable

The current priority is validation and hardening of already-large functionality:

- real Codex/OpenCode protocol contract tests;
- model/reasoning/plugin/usage compatibility;
- systemd/manual-launch parity;
- reconnect and duplicate-mutation safety;
- mobile/Chromebook release smoke coverage;
- host integration validation;
- authentication/token-storage hardening;
- documentation that matches implementation.

Security and integration findings should be fixed before turning experimental surfaces into release claims.

## Next — finish the daily mobile workflow

High-value work after the reliability gate:

- richer Git/diff review;
- better project/context/file selection;
- notification and waiting-state UX;
- attachment lifecycle/retention;
- accessibility and mobile ergonomics;
- clearer diagnostics and first-run setup;
- packaging/install/update improvements.

## Later — scale and extensibility

Only after single-host behavior is predictable:

- stronger device/session controls;
- multi-host UX;
- broader agent/provider adapters;
- extension/plugin discovery;
- safer scheduled/event-driven automation;
- optional relay research without weakening the host-local trust model.

## Explicitly planned, not shipped

These should stay labeled as planned until they have a real implementation and validation path:

- DevMoter Library;
- Google/Microsoft/Apple sign-in;
- public multi-user authorization;
- production relay service.

## Pull-request rule

Prefer small, independently reviewable PRs linked to concrete issues. A broad roadmap item is not complete because one child feature landed.

## Validation rule

A UI element is not evidence that a feature works. Shipped claims should have a real backend path and, where practical, contract/integration coverage. Device-specific claims require real-device validation until equivalent automation exists.

## Licensing rule

External projects are product/UX research unless their source license is verified compatible. Reimplement ideas independently by default; do not copy incompatible source into DevMoter.
