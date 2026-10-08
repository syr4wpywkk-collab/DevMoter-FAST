# DevMoter FAST — Frontend architecture v2 (incremental migration)

Status: Phase 1 implemented in this PR; React adoption is **not yet implemented or approved**.

## Current constraints

- The application is a Vite + TypeScript frontend embedded in a privileged, self-hosted Node.js control plane.
- Codex, OpenCode and API Chat have independent UX and event/permission logic. Their state is not interchangeable.
- The main entrypoint mounts all three workspaces, Home, tools and navigation. Backend switching and URL history are governed by `src/surface-navigation.mjs`.
- No release may claim real-device validation without running the Chromebook/iPhone smoke checklist.

## Phase 1 — safe seams (this PR)

1. Split the previously ~7,000-line `src/style.css` into `src/styles/base.css`, `workspace.css`, `tools.css` and `chat-extras.css`. The same text is preserved in the same order by four CSS imports. Do **not** deduplicate selectors or rewrite the cascade in this phase.
2. Fix Home's previously unhandled “Go to Chat” button by using the existing fixed app-registry launch callback; do not bypass shell navigation or authorization.
3. Keep the UI action large enough for touch, label its purpose for assistive technology, and cover both normal launch and preview behavior with a bundled JSDOM test.
4. Add a CSS-module contract test to catch missing modules and changed import order.

## Phase 2 — slice code before framework choice

- Isolate shared *pure* formatting, model normalization and message projection from `src/codex.ts` and `src/opencode.ts`, without moving their sockets, session lifetimes, permissions or mutable execution state in the same PR.
- Define explicit typed API boundaries for requests, stream events and permissions; avoid a new state store that accidentally duplicates backend state.
- Extract one concern per small PR, preserve existing public exports and smoke-test history restoration, approvals, streaming and reconnect.
- Avoid arbitrary line-count targets; cohesion and explicit ownership outrank file size.

## React decision gate (not part of Phase 1)

React is a plausible **opt-in, client-side view layer**, not a reason to replace the Node.js server, introduce SSR/Next.js, or rewrite authentication.

The first React proof of concept should:

1. Pick an isolated Home or settings card; preserve its existing mount container and callback-based app launch contract.
2. Add React and React DOM through npm with a regenerated, committed `package-lock.json` (never use a runtime CDN or import-map workaround).
3. Use React/TSX for *that component only*. Do not render React into an element owned by the legacy DOM renderer.
4. Cleanly mount/unmount and show no duplicate listeners after remounting, switching views or navigating Back/Forward.
5. Meet keyboard, focus, screen-reader, mobile safe-area and touch target acceptance criteria.
6. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:coverage`, `npm run security:audit`, dependency audit and CodeQL.
7. Compare bundle size, boot behavior and runtime errors against the vanilla implementation. If it is worse without a concrete maintenance benefit, do **not** expand React.

Only after that pilot is reviewed should another PR convert a larger feature surface. Keep streaming transports and command-approval security server-owned.

## Important review rule

The CSS split is a mechanically intended no-visual-change refactor. The Home CTA usability fix is intentional. Do not combine either with redesign of Codex/OpenCode or a new authorization model in this PR.

## Manual smoke gate

On Chromebook and iPhone (where available), open Home, click **Continue working**, confirm navigation into the previously selected chat backend, return Home with browser navigation, open an app preview, and verify layouts at narrow width, dark mode and safe-area insets. The scripted test suite is not a substitute for this verification.
