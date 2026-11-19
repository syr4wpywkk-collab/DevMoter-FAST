# Chat headers (Codex / OpenCode / API Chat)

Phase 2 (#340): the three chat headers carry the same information in the same order.

| Slot | Codex | OpenCode | API Chat |
| --- | --- | --- | --- |
| Screen / AI switch (☰, unified UI) | `data-workspace-menu-button` | same | same |
| Conversation history | `#cxMenu` | `#ocxMenu` | `#apiMenu` |
| Identity: title + one-line context | `#cxTitle` / `#cxModelLabel` | `#ocxSessionTitle` / `#ocxSessionMeta` | `API Chat` / `#apiModelTopLabel` |
| Context control | Usage, Details | Model | Provider settings |
| New conversation | `#cxNewChatTop` | `#ocxNewSessionTop` | `#apiNewChatTop` |

Rules:

- Title 1rem/600, subtitle caption size, both one line with ellipsis so long session titles never push actions off screen.
- Header actions are line-icon SVGs with `aria-label` and `title`; no symbol glyphs (＋, ⚙), which render as empty boxes on some fonts.
- `#apiNewChatTop` clicks the sidebar `#apiNewChat`, so upload guards, request abort and draft archiving stay on one path.

Verification: `node --test test/chat-header-layout.test.mjs`, then `npm run test:workspace-browser` (390px and desktop).
