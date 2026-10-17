# DevMoter FAST — HTML reference into real cybernetic home (2026-10-18)

## Input and translation

The user supplied a Z-Code/GLM-style HTML mockup headed "統合コントロールホーム", with dark grid background, cyan accents, three-column launch cards, search, example agent metrics, canned recents, and a system dock.

Implemented the **layout and visual language** in the real Home owned by \`src/home.ts\` / \`src/home.css\`. The reference HTML is an untrusted design input; scripts, Tailwind CDN, nonworking anchor URLs, GLM branding and demonstration runtime values were not copied.

## Real wiring

- Cards render from \`APP_REGISTRY\` and delegate to the existing onLaunchApp/onPreviewApp callbacks.
- Existing registered apps remain discoverable, including Preview/Unavailable status. Office and Browser were not silently removed.
- Search button and Ctrl/Cmd+K filter real registered apps; Escape returns focus.
- "最近使ったアプリ" shows only the three most recently opened modules on **this browser**, stored as allowlisted IDs and timestamps. This **does not** claim to be agent session history.
- "セッション履歴を見る" opens the existing Sessions app. The working React provider quick-switch remains isolated, with the existing dispose lifecycle.
- Header status is read from \`/api/health\` (OpenCode/Codex booleans) on Home navigation; failure or malformed results display "接続状況を取得できません" rather than fictitious online/token/latency numbers.
- Existing global Tools button, system panels and shell navigation own their functionality; the source mockup's fake bottom-dock handlers were not duplicated.

## Safety and runtime boundaries

No new API routes, provider credentials, login, host commands, MCP calls, execution approvals or permission changes. Dynamic text uses \`textContent\`; recent IDs are validated against the registry. Missing localStorage falls back to an empty list, without affecting navigation.

## Validation

- CI: \`npm ci\`, typecheck, lint, build, tests and coverage
- Security Audit and CodeQL on the PR head
- Manual verification still needed on actual Chromebook/iPhone: 375/390/430px, 768px, 1366px; long app titles, preview toast, Ctrl/Cmd+K, React shortcuts, bottom dock, keyboard, safe-area, real health status. Do not claim screenshots or real local integration tests unless performed.

## Rollback

Revert this PR to restore the prior Home renderer and CSS without modifying project history, credentials or sessions.
