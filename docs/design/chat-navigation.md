# Chat navigation (Codex / OpenCode / API Chat)

Phase 2 (#336) fixes one navigation model for the three chat surfaces.

| Control | Where | What it does |
| --- | --- | --- |
| ☰ (`data-workspace-menu-button`) | left edge of every header | Switches screens (Home, Tasks, Chat, Review, Tools, Terminal) and the chat AI (Codex / OpenCode / API Chat). The only AI switcher. |
| History icon (`data-chat-history-trigger`, `#cxMenu` / `#ocxMenu` / `#apiMenu`) | right of ☰ | Opens the current AI's own conversation list. Never switches AI. |

Rules:

- The history trigger comes from `src/chat-history-trigger.mjs` (registry `history` line icon, `nav.openChatHistoryAria` / `nav.chatHistoryTitle`). Do not render a second ☰ for history.
- AI switching goes through `setBackend` → `surfaceNavigation`, so the URL (`?surface=`) and browser back stay in sync. Native per-provider switch buttons were removed in #500 and stay removed.
- Opening one menu closes the other (`devmoter:close-global-nav` / `devmoter:close-chat-history`).
- Transcript, composer, streaming and permissions stay provider-owned; this is presentation and routing only.

Verification: `node --test test/chat-history-trigger.test.mjs test/unified-workspace-nav.test.mjs`, then `npm run test:workspace-browser` for the mobile/desktop smoke.
