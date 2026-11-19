# Chat sidebars: history first

Each chat surface's sidebar is its conversation list. Order, top to bottom:

1. Identity + close
2. New chat
3. Search / filter
4. Conversation history (fills the scroll area)
5. Secondary tools (Codex only: Projects, Plugins, Integrations, Developer workflows), pinned below the scroller
6. Footer (language, connection state)

| Surface | History element | Tools |
| --- | --- | --- |
| Codex | `#cxSidebarThreads` | `nav.cx-side-nav` (`codex.sidebar.toolsAria`), outside `.cx-sidebar-scroll` |
| OpenCode | `#ocxSessions` | Tools button in the sidebar head |
| API Chat | `#apiHistory` | None in the sidebar |

Switching screens or AI stays in the ☰ workspace menu (see `chat-navigation.md`).

Verify with `node --test test/codex-history-sidebar.test.mjs test/tools-navigation.test.mjs`.
