# 機能成熟度の根拠一覧（feature status）

この文書は、README（[English](../README.md) / [日本語](../README.ja.md) / [简体中文](../README.zh-CN.md)）の機能成熟度表の各行について、根拠となる API ルート・実装ファイル・テストファイルと、まだ検証されていない範囲をまとめたものです（Issue #536）。

- 確認した基準コミット: `main` @ `fe7dd4e84bcec955ba5bf96d64c85e463f0827d9`（2026-11-03 時点）
- 成熟度の定義は README と同じです。「実装済み（Shipped）」は実際の backend 経路があること、「実験的（Experimental）」は実装はあるが堅牢化や広い検証が必要なこと、「計画中（Planned）」はまだ提供機能ではないことを示します。
- ここでの「テスト」は `npm test`（`node --test test/*.test.mjs test/**/*.test.mjs`）と `npm run test:workspace-browser`（`e2e/`）で CI 実行されるものです。
- 「ルート単位のテストなし」は、モジュール単体のテストはあるが HTTP ルートを直接呼ぶテストが見つからなかったことを意味します。

## 更新ルール

README の成熟度表（3言語のどれか）を変更する PR では、同じ PR でこの一覧も更新してください。成熟度を上げる場合は、根拠となるルートとテストをこの一覧に追加してください。根拠が示せない行は「実験的」または「計画中」に下げます。PR テンプレート（`.github/pull_request_template.md`）にも確認項目があります。

## 一覧

| # | 領域 | README の表記 | 判定 |
| --- | --- | --- | --- |
| 1 | Agent workspace | 実装済み・上流依存 | 根拠あり・維持 |
| 2 | Projects | 実装済み | 根拠あり・維持 |
| 3 | GitHub workspace | 実装済み・範囲限定 | 根拠あり・維持（ルート単位のテストなし） |
| 4 | Tools AI | 実験的 | 根拠あり・維持 |
| 5 | Reviewed Changes | 実験的 | 根拠あり・維持（ルート単位のテストなし） |
| 6 | Session control | 実験的 | 根拠あり・維持 |
| 7 | Terminal | 実験的 | 根拠あり・維持 |
| 8 | API Chat / routing | 実験的 | 根拠あり・維持 |
| 9 | Developer workflows | 機能ごとに異なる | 根拠あり・維持（ルート単位のテストなし） |
| 10 | Host protocol | v1 探索契約・Adapter ごとに差あり | 根拠あり・維持 |
| 11 | Automation / integrations | 実験的 | 根拠あり・維持 |
| 12 | Web / PWA | 実装済み | 根拠あり・維持 |
| 13 | iOS client | 実験的・実機検証が必要 | 自動テストなし・表記どおり実験的 |

### 1. Agent workspace（実装済み・上流依存）

- API ルート: `/api/opencode/*`（`/api/opencode/session/*`、`/api/opencode/event` など）、`/api/codex/rpc`、`/api/codex/events`、`/api/codex/approval`、`/api/codex/upload`、`/api/codex/health`（`server.mjs`）
- 実装: `server/opencode-adapter.mjs`、`server/opencode-api.mjs`、`server/codex-bridge.mjs`
- テスト: `test/opencode-adapter.test.mjs`、`test/opencode-adapter-routes.integration.test.mjs`、`test/opencode-events.test.mjs`、`test/opencode-proxy-ssrf.test.mjs`、`test/opencode-proxy-disconnect.test.mjs`、`test/codex-bridge.test.mjs`、`test/codex-thread-history.test.mjs`、`test/codex-reasoning-contract.test.mjs`、`test/codex-not-installed.test.mjs`、`test/backend-integration.test.mjs`、`e2e/codex-layout.test.mjs`
- 未検証の範囲: 実際の OpenCode / Codex CLI との接続は CI では行っていません（OpenCode はフィクスチャ `test/fixtures/opencode/opencode-v1.19.5.json` と `opencode-v2.0.9.json` のみ）。それ以外の上流バージョン、上流の認証状態、実機ブラウザでの長時間ストリーミング。

### 2. Projects（実装済み）

- API ルート: `GET/POST /api/projects`、`/api/projects/:id`（DELETE）、`/api/projects/:id/docs`、`/api/projects/:id/file`、`/api/projects/:id/git/(status|files|diff)`、`/api/projects/:id/index(/rebuild|/status|/search)`（`server.mjs`）
- 実装: `server.mjs`、`server/safe-file.mjs`、`server/project-index.mjs`
- テスト: `test/server-smoke.test.mjs`、`test/tool-center-projects.test.mjs`、`test/safe-file.test.mjs`、`test/security.test.mjs`（Markdown パスの拒否条件）、`test/project-index.test.mjs`
- 未検証の範囲: `/api/projects/:id/docs` と `/api/projects/:id/file` を HTTP 経由で呼ぶテストは見つかりませんでした（パス検証はモジュール単体でテスト済み）。大きなリポジトリ、Linux 以外の OS、シンボリックリンクを多く含む実プロジェクト。

### 3. GitHub workspace（実装済み・範囲限定）

- API ルート: `GET /api/github/status`、`GET /api/github/repos`、`GET /api/github/repos/:owner/:repo/branches`、`POST /api/github/open`、`POST /api/github/fetch`（`server.mjs`）
- 実装: `server/github.mjs`、`server/git-workspace.mjs`
- テスト: `test/github.test.mjs`、`test/github-managed-path.test.mjs`、`test/git-workspace.test.mjs`、`test/github-picker-regression.test.mjs`
- 未検証の範囲: ルート単位のテストなし。実際の `gh` 認証と実リポジトリでの clone / fetch は CI では行っていません。手動確認手順は [GITHUB_WORKSPACE_DEVICE_SMOKE.md](./GITHUB_WORKSPACE_DEVICE_SMOKE.md)。

### 4. Tools AI（実験的）

- API ルート: `/api/tools-ai/runs`、`/api/tools-ai/context`、`/api/tools-ai/*`（`server.mjs`）
- 実装: `server/tools-ai/catalog.mjs`、`dispatcher.mjs`、`planner.mjs`、`projection.mjs`、`run-store.mjs`、`service.mjs`
- テスト: `test/tools-ai-catalog.test.mjs`、`test/tools-ai-planner.test.mjs`、`test/tools-ai-runtime.test.mjs`、`test/tools-ai-server.integration.test.mjs`、`test/tools-ai-ui.test.mjs`、`test/tools-ai-unavailable-fails.test.mjs`
- 未検証の範囲: 実モデルを使った自然言語ルーティングの精度、長時間 run のキャンセル。仕様は [tools-ai-v1.md](./tools-ai-v1.md)。

### 5. Reviewed Changes（実験的）

- API ルート: `/api/workflow/*`（`server.mjs`）
- 実装: `server/task-workflow.mjs`
- テスト: `test/task-workflow.test.mjs`、`test/review-overlay-ui.test.mjs`、`test/git-diff-accessibility-ui.test.mjs`
- 未検証の範囲: ルート単位のテストなし。実リポジトリでの apply / commit / worktree / PR 作成の通し確認。

### 6. Session control（実験的）

- API ルート: `/api/session-control/*`（`state`、`queue`、`checkpoints`、`ownership`、`budget`、`events` など。`server.mjs`、`server/session-control.mjs`）
- 実装: `server/session-control.mjs`
- テスト: `test/session-control-reliability.test.mjs`、`test/session-control-security.test.mjs`、`test/session-control-ui-contract.test.mjs`、`test/session-search-query.test.mjs`
- 未検証の範囲: 実際の上流エージェントでの fork / handoff、端末をまたぐ background run の再接続。

### 7. Terminal（実験的）

- API ルート: `/api/terminal/sessions` と Terminal WebSocket（`server.mjs`、`server/terminal.mjs`、`server/terminal-websocket.mjs`）
- 実装: `server/terminal.mjs`、`server/terminal-session-store.mjs`、`server/terminal-websocket.mjs`
- テスト: `test/terminal-persistence.test.mjs`、`test/terminal-auth.test.mjs`、`test/terminal-sessions-security.test.mjs`、`test/terminal-websocket.integration.test.mjs`、`test/tool-center-terminal.test.mjs`
- 未検証の範囲: iOS Safari など実機ブラウザでの長時間接続、Linux 以外のホスト。詳細は [TERMINAL_SESSIONS.md](./TERMINAL_SESSIONS.md)。

### 8. API Chat / routing（実験的）

- API ルート: `/api/llm/providers`、`/api/llm/presets`、`/api/llm/chat`、`/api/llm/test`、`/api/llm/attachments`（`server.mjs`）
- 実装: `server/multi-api.mjs`、`server/multi-api-attachments.mjs`
- テスト: `test/multi-api.test.mjs`、`test/multi-api-v3-integration.test.mjs`、`test/multi-api-vault-integration.test.mjs`、`test/api-chat-conversations.test.mjs`、`test/api-attachment.test.mjs`、`test/model-routing.test.mjs`
- 未検証の範囲: 実際の各プロバイダー API への接続（CI では行っていません）、プロバイダーごとの Reasoning 制御と Failover の実挙動。

### 9. Developer workflows（機能ごとに異なる）

- API ルート: `/api/dev/capabilities`、`/api/dev/settings`、`/api/dev/mcp`、`/api/dev/mcp/enabled`、`/api/dev/mcp/test`、`/api/dev/acp/probe`、`/api/dev/extension/approve`、`/api/dev/verify`、`/api/dev/review`、`/api/dev/review/comment`、`/api/dev/ci`、`/api/dev/repair`、`/api/dev/session-context`（`server.mjs`）
- 実装: `server/dev-workflows.mjs`、`server/acp-adapter.mjs`
- テスト: `test/dev-workflows.test.mjs`、`test/developer-workflow-hardening.test.mjs`、`test/acp-adapter.test.mjs`
- 未検証の範囲: ルート単位のテストなし。実際の MCP サーバー・ACP エージェント・Extension との接続。機能ごとの状態は [developer-workflows.md](./developer-workflows.md)。

### 10. Host protocol（v1 探索契約・Adapter ごとに差あり）

- API ルート: `GET /api/host`（`server.mjs`）
- 実装: `server/host/protocol.mjs`、`server/host/adapters.mjs`
- テスト: `test/host-protocol.test.mjs`、`test/auth-server.integration.test.mjs`（`/api/host` の認証）
- 未検証の範囲: v1 の Capability discovery 契約以外。Adapter ごとの実際の機能差。仕様は [HOST_PROTOCOL.md](./HOST_PROTOCOL.md)。

### 11. Automation / integrations（実験的）

- API ルート: `/api/control/hosts`、`/api/control/hosts/status`、`/api/control/schedules`、`/api/control/triggers`、`/api/control/runs`、`/api/control/autopilot`、`/api/control/events/github`、`/api/integrations/status`、`/api/cli`（`server.mjs`）
- 実装: `server/control-plane.mjs`、`server/automation-api.mjs`、`server/user-automation.mjs`、`server/integrations.mjs`、`server/cli-launch.mjs`
- テスト: `test/control-plane-v3.test.mjs`、`test/automation-api-v3.test.mjs`、`test/user-automation.test.mjs`、`test/integration-launch-contracts.test.mjs`、`test/integration-launch-210.test.mjs`、`test/integrations-security.test.mjs`、`test/cli-launch.test.mjs`、`test/remote-automation-security.test.mjs`、`test/remote-auth-boundary.test.mjs`
- 未検証の範囲: 実際のリモートホスト・GitHub Webhook・外部連携（Antigravity / Claude など）との通し確認。安全上の前提は [remote-control-security.md](./remote-control-security.md) と [AUTOMATION.md](./AUTOMATION.md)。

### 12. Web / PWA（実装済み）

- 経路: `index.html`、`public/manifest.webmanifest`、`public/sw.js`、`server.mjs` の静的配信
- テスト: `test/pwa-public-assets.test.mjs`、`test/index-html-pwa-meta.test.mjs`、`test/pwa-backend.integration.test.mjs`、`e2e/unified-workspace-tabs.test.mjs`、`e2e/codex-layout.test.mjs`、`npm run lint`（manifest のアイコン検査）
- 未検証の範囲: 実機（iOS / Android）でのホーム画面インストールと更新。Service Worker のキャッシュ更新の回帰テストは PR #541 で追加予定（この一覧の作成時点では未マージ）。

### 13. iOS client（実験的・実機検証が必要）

- 経路: `ios/DevMoter/DevMoterApp.swift`、`ios/project.yml`、`.github/workflows/ios-altstore.yml`
- テスト: 自動テストは見つかりませんでした（根拠はビルド定義のみ）。
- 未検証の範囲: 実機での接続・認証・再接続のすべて。そのため表記は「実験的・実機検証が必要」のままとします。手順は [ios-altstore.md](./ios-altstore.md)。

## 追加予定の行（未マージ PR）

- **Qwen Code**（PR #538 で README に「実験的」として追加予定）
  - API ルート: `/api/qwen/chat`、`/api/qwen/chat/cancel`、`/api/qwen/models`、`/api/qwen/providers`（`server.mjs`）
  - 実装: `server/qwen-chat.mjs`、`server/qwen-models.mjs`、`server/qwen-code-providers.mjs`
  - テスト: `test/qwen-chat.test.mjs`、`test/qwen-models.test.mjs`、`test/qwen-chat-ui.test.mjs`
  - 未検証の範囲: 実際の `qwen` CLI とすべてのバージョン・プロバイダーでの動作。
  - PR #538 がマージされたら、この項目を上の一覧（14 行目）へ移してください。

## 简体中文 README について

`README.zh-CN.md` の表は以前、英語・日本語版と異なる行の分け方でした。この一覧と一致させるため、同じ 13 行の表に揃えました。以前の中文版だけにあった行は、表の下の「其他条目」表に残しています（Library と Apple 登录は従来どおり「计划中」、Google / Microsoft 登录の根拠は `server/oidc-auth.mjs` と `test/oidc-auth.test.mjs`、Passkey の根拠は `server/passkey-auth.mjs` と `test/passkey-auth-v3.test.mjs`）。
