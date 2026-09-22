# DevMoter control-plane roadmap

Issue #14 is the umbrella roadmap for the "best-of mobile coding-agent control plane" work. It is intentionally an epic rather than a single implementation task.

## Baseline to preserve

Current `main` already provides the foundations future work must not regress:

- distinct Codex and OpenCode surfaces rather than a generic terminal wrapper;
- Projects and GitHub-backed workspace selection;
- server-side Project-ID path resolution;
- localhost-first/Tailscale deployment;
- operation-ID duplicate suppression;
- reconnect and execution-state recovery;
- approval/question flows;
- PWA/mobile-first navigation.

## Phase order

### Phase 0 — reliability and release safety

Finish the hardening work before broad expansion:

1. authentication and security boundaries;
2. duplicate-mutation/reconnect behavior;
3. automated smoke and protocol tests;
4. architecture/threat-model documentation;
5. legal/branding/third-party notice audit;
6. real Chromebook + iPhone smoke validation.

### Phase 1 — high-value coding controls

Prioritize review and intervention surfaces that are useful from a phone:

- Git status and diff review;
- compact file explorer/context picker;
- safe terminal access;
- completion/waiting notifications;
- diagnostics and first-run setup.

### Phase 2 — host/device scale

After single-host reliability is boring and predictable:

- device pairing/revocation;
- passkey/WebAuthn option;
- multi-host registry and host-scoped projects/sessions;
- optional relay research without weakening the local-first model.

### Phase 3 — automation and extensibility

Only after the safety policy is explicit:

- scheduled/event-triggered tasks;
- bounded autopilot;
- CLI/SDK;
- provider/model/agent abstraction;
- extension catalog;
- deterministic tool policy.

## Pull-request rule

Child work should land as small, independently reviewable PRs linked to its concrete issue. The epic should remain open while child issues are active; completing one child feature must not be treated as completing the whole control-plane roadmap.

## Licensing rule

External projects referenced by #14 are product and UX research unless their exact source license is verified compatible. Reimplement ideas independently by default. Do not copy AGPL, GPL, FSL, enterprise-only, or otherwise incompatible source into DevMoter.

## Validation rule

Do not claim iPhone/Chromebook behavior based only on desktop CI. Device-specific acceptance remains manual until an equivalent automated environment exists.
