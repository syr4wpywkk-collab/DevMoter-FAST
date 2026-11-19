# Feature Status & Implementation Grounding

このドキュメントは、[README.md](../README.md)（「What DevMoter brings together」）および [README.ja.md](../README.ja.md)（「統合する機能」）の成熟度表にある各行について、実際のサーバー実装ルート・自動テスト・未検証範囲を対応づけて記録します（Issue #536）。

> [!NOTE]
> Issue #536 起票時点の v3 表は 13 行（#498）でしたが、その後 #538 で `Qwen Code` が追加されたため、現在の表は **14 行**です。本書では現行の 14 行すべてに加え、v2 表を維持している [README.zh-CN.md](../README.zh-CN.md)（「功能状态」、16 行）との対応も記録しています。

## 成熟度ラベルの基準と今回の見直し

- **実装済み（Shipped）**: 実際の backend 経路が存在し、かつ自動の統合/契約テスト等による裏付けがある機能。
- **実験的（Experimental）**: 実装は存在するが、追加の堅牢化、HTTP/統合テスト、または実機・実上流環境での検証が未完了な機能。
- **計画中（Planned）**: まだ提供機能として実装されていない機能。

### 今回のラベル変更

- **GitHub Workspace**: `実装済み・範囲限定`（`Shipped; scope-limited` / `✅ Shipped`）→ **`実験的・範囲限定`**（`Experimental; scope-limited` / `🧪 Experimental`）へ引き下げました。
  - **理由**: `server.mjs` / `server/github.mjs` に `/api/github/*` のルートは存在するものの、自動テストは `validateRepoIdentity`・symlink/`.git` file 拒否・UI 文字列チェックのみで、`/api/github/*` の HTTP 統合テストおよび `githubStatus` / `listGithubRepos` / `listGithubBranches` / 正常系 `openGithubRepo` / `fetchGithubRepo` の自動テストが未整備です。また [docs/GITHUB_WORKSPACE_DEVICE_SMOKE.md](./GITHUB_WORKSPACE_DEVICE_SMOKE.md)（#13）でも実機 Chromebook + iPhone 受け入れゲートが未完了（`required testing, not completed testing`）と明記されています。

---

## 一覧表（現行 README / README.ja 全 14 行）

| # | 機能（README.ja / README） | 成熟度 | 根拠となる API ルート | 主な実装ファイル | 主なテストファイル | 未検証範囲（主なギャップ） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [Agent Workspace](#1-agent-workspace) | 実装済み・上流依存 (`Shipped; upstream-dependent`) | `/api/opencode/*`, `/api/codex/*`, `/api/health` | `server.mjs`, `server/opencode-api.mjs`, `server/opencode-adapter.mjs`, `server/codex-bridge.mjs` | `test/opencode-adapter-routes.integration.test.mjs`, `test/backend-integration.test.mjs`, `test/codex-bridge.test.mjs` ほか | 実 OpenCode / 実 Codex CLI との実通信、上流バージョン差分、実 iOS/Chromebook 挙動 |
| 2 | [Projects](#2-projects) | 実装済み (`Shipped`) | `/api/projects`, `/api/projects/:id/*` | `server.mjs`, `server/project-index.mjs`, `server/git-workspace.mjs`, `server/advanced-api.mjs` | `test/auth-server.integration.test.mjs`, `test/server-smoke.test.mjs`, `test/advanced-features.test.mjs`, `test/project-index.test.mjs` ほか | `DELETE /api/projects/:id`・`/docs`・`/git/*` の HTTP 統合テスト、実機モバイルでの操作 |
| 3 | [GitHub Workspace](#3-github-workspace) | **実験的・範囲限定** (`Experimental; scope-limited`) | `/api/github/status`, `/api/github/repos`, `/api/github/repos/:owner/:repo/branches`, `/api/github/open`, `/api/github/fetch` | `server.mjs`, `server/github.mjs`, `src/codex.ts` | `test/github.test.mjs`, `test/github-managed-path.test.mjs`, `test/github-picker-regression.test.mjs` | `/api/github/*` の HTTP 統合テスト、正常系 `gh`/`git` テスト、Chromebook + iPhone 実機検証（#13） |
| 4 | [Tools AI](#4-tools-ai) | 実験的 (`Experimental`) | `/api/tools-ai/*` | `server.mjs`, `server/tools-ai/*.mjs`, `src/tools-ai.ts` | `test/tools-ai-catalog.test.mjs`, `test/tools-ai-planner.test.mjs`, `test/tools-ai-runtime.test.mjs`, `test/tools-ai-server.integration.test.mjs`, `test/tools-ai-ui.test.mjs`, `test/tools-ai-unavailable-fails.test.mjs` | 実外部 LLM プロバイダ品質、実 iOS Safari キーボード/safe-area、v2 書き込み系操作 |
| 5 | [Reviewed Changes](#5-reviewed-changes) | 実験的 (`Experimental`) | `/api/workflow/projects/:projectId/*` | `server.mjs`, `server/task-workflow.mjs`, `src/workflow.ts` | `test/task-workflow.test.mjs`, `test/review-overlay-ui.test.mjs`, `e2e/unified-workspace-tabs.test.mjs` | `/api/workflow/*` の実 HTTP サーバー統合テスト、実 GitHub PR/Issue (`gh`)・`git push`、実機レビュー操作 |
| 6 | [Session Control](#6-session-control) | 実験的 (`Experimental`) | `/api/session-control/*`, `/api/agent-runs*`, `/api/agent-fleets*`, `/api/workspace-control/*`, `/api/codex/rpc`（`thread/fork`） | `server.mjs`, `server/session-control.mjs`, `server/agent-run-service.mjs`, `server/agent-run-api.mjs`, `server/workspace-control.mjs`, `src/session-control.ts`, `src/session-search-query.mjs` | `test/session-control-reliability.test.mjs`, `test/session-control-security.test.mjs`, `test/session-control-ui-contract.test.mjs`, `test/session-search-query.test.mjs`, `test/agent-run-api.test.mjs`, `test/agent-run-service.test.mjs` ほか | `/api/session-control/checkpoints`・`ownership`・`events` の HTTP 統合テスト、実エージェント再起動復旧 |
| 7 | [Terminal](#7-terminal) | 実験的 (`Experimental`) | `/api/terminal/sessions*`, WebSocket `/api/terminal/sessions/:id/socket` | `server.mjs`, `server/terminal.mjs`, `server/terminal-websocket.mjs`, `server/terminal-session-store.mjs` | `test/terminal-auth.test.mjs`, `test/terminal-persistence.test.mjs`, `test/terminal-sessions-security.test.mjs`, `test/terminal-websocket.integration.test.mjs`, `test/terminal-gate-flow.test.mjs` ほか | 実 `tmux` + `systemd` 再起動跨ぎ（`KillMode=control-group`）、macOS/Windows/WSL 実機、モバイル実端末入力 |
| 8 | [API Chat / Routing](#8-api-chat--routing) | 実験的 (`Experimental`) | `/api/llm/*`, `/api/advanced/models*`, `/api/advanced/providers` | `server.mjs`, `server/multi-api.mjs`, `server/multi-api-attachments.mjs`, `server/advanced-api.mjs`, `server/advanced-features.mjs`, `src/api-chat.ts`, `src/model-routing.mjs` | `test/multi-api.test.mjs`, `test/multi-api-v3-integration.test.mjs`, `test/multi-api-vault-integration.test.mjs`, `test/api-chat-conversations.test.mjs`, `test/model-routing.test.mjs`, `test/advanced-features.test.mjs` ほか | 実外部プロバイダ API との疎通・障害時フェイルオーバー、実機添付・UI 検証 |
| 9 | [Qwen Code](#9-qwen-code) | 実験的・ローカルに Qwen Code CLI が必要 (`Experimental; requires a locally installed Qwen Code CLI`) | `/api/qwen/chat`, `/api/qwen/models`, `/api/qwen/providers`, `/api/qwen/chat/cancel`, `/api/integrations/qwen/launch`, `/api/integrations/status` | `server.mjs`, `server/qwen-chat.mjs`, `server/qwen-models.mjs`, `server/qwen-code-providers.mjs`, `server/integrations.mjs`, `src/feature-flags.mjs`, `src/qwen-chat.ts`, `src/qwen-model-picker.ts` | `test/qwen-chat.test.mjs`, `test/qwen-models.test.mjs`, `test/qwen-chat-ui.test.mjs`, `test/qwen-ui-gate.test.mjs`, `test/integrations-ui.test.mjs`, `test/integration-launch-contracts.test.mjs` | 既定では UI 非公開（`src/feature-flags.mjs` の `QWEN_UI_ENABLED = false`）、実 `qwen` CLI バイナリ実行、各種 Qwen Code バージョン・プロバイダ互換性、`/api/qwen/*` の実 HTTP サーバー統合テスト |
| 10 | [Developer Workflows](#10-developer-workflows) | 機能ごとに異なる (`Mixed; see docs`) | `/api/dev/*`, `/api/agent-runs*`, `/api/agent-fleets*` | `server.mjs`, `server/dev-workflows.mjs`, `server/acp-adapter.mjs`, `server/agent-run-service.mjs`, `server/agent-run-api.mjs`, `src/dev-workflows-ui.ts` | `test/dev-workflows.test.mjs`, `test/developer-workflow-hardening.test.mjs`, `test/acp-adapter.test.mjs`, `test/agent-run-api.test.mjs`, `test/agent-run-service.test.mjs`, `test/sheet-theme-frame.test.mjs` | `/api/dev/*` の HTTP 統合テスト、`verify`/`repair`/`review`/`ciStatus`/`probeAcp`/`testMcpServer`/`sessionContext` の自動テスト、実 ACP エージェント・実 GitHub PR コメント |
| 11 | [Host Protocol](#11-host-protocol) | v1 探索契約・Adapter ごとに差あり (`v1 discovery contract; adapters vary`) | `GET /api/host` | `server.mjs`, `server/host/protocol.mjs`, `server/host/adapters.mjs` | `test/host-protocol.test.mjs`, `test/auth-server.integration.test.mjs`, `test/mission-control.test.mjs` | 実 macOS / 実 Windows+WSL ホスト、`processes` / `services` / `ports` / `browser`（`server.mjs` 上は `not_implemented`） |
| 12 | [Automation / Integrations](#12-automation--integrations) | 実験的 (`Experimental`) | `/api/control/*`, `/api/automation/*`, `/api/projects/:id/context*`, `/api/user-automation*`, `/api/integrations/*`, `/api/cli`, `/api/advanced/browser*`, `/api/advanced/sandbox`, `/api/advanced/grants*` | `server.mjs`, `server/control-plane.mjs`, `server/automation-api.mjs`, `server/context-references.mjs`, `server/user-automation.mjs`, `server/integrations.mjs`, `server/cli-launch.mjs`, `server/advanced-api.mjs`, `server/browser-tool.mjs` | `test/control-plane-v3.test.mjs`, `test/remote-auth-boundary.test.mjs`, `test/remote-automation-security.test.mjs`, `test/automation-api-v3.test.mjs`, `test/context-references-v3.test.mjs`, `test/user-automation.test.mjs`, `test/integration-launch-210.test.mjs`, `test/integration-launch-contracts.test.mjs`, `test/integrations-security.test.mjs`, `test/auth-server.integration.test.mjs` ほか | `POST /api/control/events/github` を含む `/api/control/*`・`/api/projects/:id/context*`・`/api/user-automation*` の HTTP 統合テスト、実 Chromebook/Crostini 上での Antigravity 起動（#210）、実 GitHub Webhook・マルチホスト環境 |
| 13 | [Web / PWA](#13-web--pwa) | 実装済み (`Shipped`) | 静的/公開パス（`/manifest.webmanifest`, `/sw.js`, `/icon-*.png`, `/apple-touch-icon.png`, `/login.html`, `/login.js`）, `GET /api/health` | `server.mjs`, `index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/login.html`, `src/main.ts`, `src/app-shell.ts`, `src/home.ts` | `test/pwa-backend.integration.test.mjs`, `test/pwa-public-assets.test.mjs`, `test/index-html-pwa-meta.test.mjs`, `test/service-worker-cache-lifecycle.test.mjs`, `test/security-headers.test.mjs`, `test/login-assets-no-build.test.mjs`, `e2e/codex-layout.test.mjs`, `e2e/unified-workspace-tabs.test.mjs` ほか | 実 iPhone Safari PWA インストール、iOS ソフトウェアキーボード・safe-area、実端末オフライン復帰（[RELEASE_SMOKE.md](../RELEASE_SMOKE.md)） |
| 14 | [iOS Client](#14-ios-client) | 実験的・実機検証が必要 (`Experimental; device validation required`) | **根拠なし**（専用 API ルートなし。既存 DevMoter サーバーへ HTTPS 接続する `WKWebView` クライアント） | `ios/DevMoter/DevMoterApp.swift`, `ios/project.yml`, `.github/workflows/ios-altstore.yml` | **根拠なし**（`test/`・`e2e/` 配下に自動テストなし。`.github/workflows/ios-altstore.yml` の macOS IPA ビルドのみ） | iPhone 実機での署名・インストール（AltStore Classic / SideStore / iloader）、HTTPS/Tailscale 接続、プロファイル間 Cookie 分離、WKWebView OAuth/Passkey リダイレクト |

---

## 各行の詳細根拠

### 1. Agent Workspace

- **成熟度**: 実装済み・上流依存（`Shipped; upstream-dependent`）
- **根拠となる API ルート**:
  - OpenCode（`server.mjs`, `server/opencode-api.mjs`, `server/opencode-adapter.mjs`, `server/agent-mode-policy.mjs`）:
    - `GET /api/health`
    - `GET /api/opencode/pocket/providers`
    - `GET /api/opencode/event`
    - `GET /api/opencode/session/active`
    - `POST /api/opencode/session/:id/prompt`, `GET /api/opencode/session/:id/context`, `POST /api/opencode/session/:id/interrupt`
    - `GET /api/opencode/session/:id/permission`, `POST /api/opencode/session/:id/permission/:rid/reply`
    - `GET /api/opencode/session/:id/question`, `POST /api/opencode/session/:id/question/:rid/reply`, `POST /api/opencode/session/:id/question/:rid/reject`
    - `/api/opencode/*`（`buildOpenCodeUpstreamTarget` による許可パスプロキシ）
  - Codex（`server.mjs`, `server/codex-bridge.mjs`, `server/security-helpers.mjs`）:
    - `GET /api/codex/health`
    - `POST /api/codex/rpc`（`CODEX_RPC_ALLOWLIST`: `thread/list`, `thread/read`, `thread/start`, `thread/resume`, `thread/fork`, `thread/loaded/list`, `thread/settings/update`, `turn/start`, `turn/steer`, `turn/interrupt`, `model/list`, `account/rateLimits/read`, `plugin/list`, `plugin/installed`, `mcpServerStatus/list`, `skills/list`）
    - `POST /api/codex/approval`
    - `POST /api/codex/upload`
    - `GET /api/codex/events`
  - 添付・補助（`server/advanced-api.mjs`, `server/upload-registry.mjs`, `server/attachments.mjs`）:
    - `GET /api/attachments/capabilities`, `POST /api/attachments/negotiate`, `POST /api/attachments/url/preview`, `POST /api/attachments/url/fetch`
- **対応するテストファイル**:
  - サーバー統合・プロキシ・アダプタ: `test/opencode-adapter-routes.integration.test.mjs`, `test/backend-integration.test.mjs`, `test/pwa-backend.integration.test.mjs`, `test/auth-server.integration.test.mjs`, `test/opencode-adapter.test.mjs`, `test/opencode-api-client.test.mjs`, `test/opencode-proxy-ssrf.test.mjs`, `test/opencode-proxy-disconnect.test.mjs`, `test/agent-mode-policy.test.mjs`, `test/codex-bridge.test.mjs`, `test/upload-registry-v3.test.mjs`, `test/attachments.test.mjs`, `test/security/codex-usage-rpc.test.mjs`
  - UI / E2E: `test/opencode-events.test.mjs`, `test/opencode-provider-catalog.test.mjs`, `test/opencode-markdown.test.mjs`, `test/opencode-session-list.test.mjs`, `test/opencode-session-title.test.mjs`, `test/opencode-turn-state.test.mjs`, `test/opencode-overlays.test.mjs`, `test/opencode-history-sidebar.test.mjs`, `test/opencode-free-view.test.mjs`, `test/opencode-model-label.test.mjs`, `test/codex-not-installed.test.mjs`, `test/codex-send-failure-ui.test.mjs`, `test/codex-model-catalog.test.mjs`, `test/codex-reasoning-contract.test.mjs`, `test/codex-plugin-metadata.test.mjs`, `test/codex-thread-history.test.mjs`, `test/codex-thread-list.test.mjs`, `test/codex-send-error.test.mjs`, `test/codex-markdown-ownership.test.mjs`, `test/codex-layout-a11y.test.mjs`, `e2e/codex-layout.test.mjs`, `e2e/unified-workspace-tabs.test.mjs`
- **未検証範囲**:
  - テストはモック OpenCode HTTP サーバー（`test/fixtures/opencode/*.json` 等）と偽 Codex stdio スクリプトを使用しており、実 OpenCode サーバーや実 `codex app-server` CLI バイナリに対する互換性は自動テスト外です。
  - 実機 Chromebook / iPhone 上でのストリーミング・承認・画像添付・障害復旧は [RELEASE_SMOKE.md](../RELEASE_SMOKE.md) による手動確認が必要です。

### 2. Projects

- **成熟度**: 実装済み（`Shipped`）
- **根拠となる API ルート**:
  - プロジェクト登録・削除・Markdown（`server.mjs`）:
    - `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:id`
    - `GET /api/projects/:id/docs`, `GET /api/projects/:id/file`, `PUT /api/projects/:id/file`
  - Git 状態・差分・インデックス・プレビュー（`server.mjs`, `server/git-workspace.mjs`, `server/project-index.mjs`, `server/advanced-api.mjs`）:
    - `GET /api/projects/:id/git/status`, `GET /api/projects/:id/git/files`, `GET /api/projects/:id/git/diff`
    - `GET /api/projects/:id/index/status`, `GET /api/projects/:id/index/search`, `POST /api/projects/:id/index/rebuild`, `DELETE /api/projects/:id/index`, `GET /api/projects/:id/map`
    - `GET /api/projects/:id/files`, `GET /api/projects/:id/preview`, `GET /api/projects/:id/artifacts`, `GET /api/projects/:id/web-preview`
- **対応するテストファイル**:
  - サーバー統合・セキュリティ: `test/auth-server.integration.test.mjs`, `test/server-smoke.test.mjs`, `test/backend-integration.test.mjs`, `test/tools-ai-server.integration.test.mjs`, `test/security.test.mjs`, `test/safe-file.test.mjs`
  - API / コンポーネント / UI: `test/advanced-features.test.mjs`, `test/advanced-navigation-ui.test.mjs`, `test/project-index.test.mjs`, `test/project-labels.test.mjs`, `test/git-workspace.test.mjs`, `test/git-diff-accessibility-ui.test.mjs`, `test/tool-center-projects.test.mjs`
- **未検証範囲**:
  - `DELETE /api/projects/:id`、`GET /api/projects/:id/docs`、`GET /api/projects/:id/git/*` を `server.mjs` 経由で叩く HTTP 統合テストは存在しません（`server/git-workspace.mjs` 単体テストおよび UI モックで検証）。
  - 実機端末上でのプロジェクト切替・ファイル閲覧は [RELEASE_SMOKE.md](../RELEASE_SMOKE.md) に委ねられています。

### 3. GitHub Workspace

- **成熟度**: **実験的・範囲限定**（`Experimental; scope-limited`） ※今回 `実装済み・範囲限定` から引き下げ
- **根拠となる API ルート**:
  - `server.mjs` / `server/github.mjs`:
    - `GET /api/github/status`
    - `GET /api/github/repos`
    - `GET /api/github/repos/:owner/:repo/branches`
    - `POST /api/github/open`
    - `POST /api/github/fetch`
  - （タスク連携の PR/Issue 操作は別途 `server/task-workflow.mjs` の `/api/workflow/projects/:projectId/github/(tasks|issue|pr)` が担当）
- **対応するテストファイル**:
  - `test/github.test.mjs`（`validateRepoIdentity` の入力検証のみ）
  - `test/github-managed-path.test.mjs`（`openGithubRepo` / `fetchGithubRepo` における symlink および非ディレクトリ `.git` の拒否のみ）
  - `test/github-picker-regression.test.mjs`（`src/codex.ts` の静的正規表現チェックのみ）
- **未検証範囲**:
  - `/api/github/status`・`/api/github/repos`・`/api/github/repos/:owner/:repo/branches`・`/api/github/open`・`/api/github/fetch` の HTTP サーバー統合テストは **根拠なし**（自動テストが存在しません）。
  - `githubStatus`、`listGithubRepos`、`listGithubBranches` および正常系の `openGithubRepo` / `fetchGithubRepo`（クローン・ブランチ切替・fetch）を実行する単体テストも存在しません。
  - 実 `gh` CLI 認証環境および Chromebook + iPhone 実機検証（[docs/GITHUB_WORKSPACE_DEVICE_SMOKE.md](./GITHUB_WORKSPACE_DEVICE_SMOKE.md) の GH-01〜GH-10、Issue #13）が未完了です。

### 4. Tools AI

- **成熟度**: 実験的（`Experimental`）
- **根拠となる API ルート**:
  - `server.mjs` / `server/tools-ai/*.mjs`:
    - `GET /api/tools-ai/context`
    - `POST /api/tools-ai/runs`
    - `GET /api/tools-ai/runs/:runId`
    - `POST /api/tools-ai/runs/:runId/stop`
    - `GET /api/tools-ai/requests/:requestId`
- **対応するテストファイル**:
  - `test/tools-ai-catalog.test.mjs`, `test/tools-ai-planner.test.mjs`, `test/tools-ai-runtime.test.mjs`, `test/tools-ai-server.integration.test.mjs`, `test/tools-ai-ui.test.mjs`, `test/tools-ai-unavailable-fails.test.mjs`, `test/tools-navigation.test.mjs`, `e2e/unified-workspace-tabs.test.mjs`
- **未検証範囲**:
  - テストはモック/フィクスチャの API Chat プロバイダを使用しており、実外部モデルの計画品質や実通信挙動は未検証です（[docs/tools-ai-v1.md](./tools-ai-v1.md)）。
  - 実 iOS Safari でのソフトウェアキーボード・safe-area 表示、および v1 スコープ外の編集・実行系操作（v1 は読み取り専用 5 操作のみ）は未実装・未検証です。

### 5. Reviewed Changes

- **成熟度**: 実験的（`Experimental`）
- **根拠となる API ルート**:
  - `server.mjs` / `server/task-workflow.mjs`:
    - `GET /api/workflow/projects/:projectId/diff`
    - `GET /api/workflow/projects/:projectId/file`
    - `GET /api/workflow/projects/:projectId/changes`, `POST /api/workflow/projects/:projectId/changes`
    - `PATCH /api/workflow/projects/:projectId/changes/:changeId/review`
    - `POST /api/workflow/projects/:projectId/changes/:changeId/apply`
    - `POST /api/workflow/projects/:projectId/changes/:changeId/commit`
    - `GET /api/workflow/projects/:projectId/worktrees`, `POST /api/workflow/projects/:projectId/worktrees`, `POST /api/workflow/projects/:projectId/worktrees/:worktreeId/cleanup`
    - `GET /api/workflow/projects/:projectId/github/tasks`, `POST /api/workflow/projects/:projectId/github/issue`, `POST /api/workflow/projects/:projectId/github/pr`
- **対応するテストファイル**:
  - `test/task-workflow.test.mjs`（一時 Git リポジトリを使った hunks・context drift・apply・commit・worktree テスト）
  - `test/review-overlay-ui.test.mjs`, `e2e/unified-workspace-tabs.test.mjs`（モック fetch による UI/E2E 検証）
- **未検証範囲**:
  - `/api/workflow/*` を実際の `server.mjs` HTTP サーバー経由で呼び出す統合テストは存在しません（`createTaskWorkflow` 直接呼び出しおよびブラウザ側モックのみ）。
  - `issueTask`（`gh issue view`）および `pullRequest`（`git push` + `gh pr create`）の実 GitHub リモート連携、ならびにモバイル実機での hunk レビュー操作性は未検証です。

### 6. Session Control

- **成熟度**: 実験的（`Experimental`）
- **根拠となる API ルート**:
  - キュー・予算・所有権・チェックポイント・イベント（`server.mjs`, `server/session-control.mjs`）:
    - `GET /api/session-control/state`
    - `POST /api/session-control/queue`, `PATCH /api/session-control/queue/:id`, `DELETE /api/session-control/queue/:id`
    - `PUT /api/session-control/budget/:backend/:sessionId`, `DELETE /api/session-control/budget/:backend/:sessionId`, `POST /api/session-control/budget/remaining`, `POST /api/session-control/budget/inherit`
    - `POST /api/session-control/ownership`
    - `POST /api/session-control/checkpoints`, `DELETE /api/session-control/checkpoints/:id`
    - `POST /api/session-control/events`
  - バックグラウンド実行・作業空間制御・Fork（`server.mjs`, `server/agent-run-service.mjs`, `server/agent-run-api.mjs`, `server/workspace-control.mjs`）:
    - `GET /api/agent-runs`, `POST /api/agent-runs`, `GET /api/agent-runs/events`, `POST /api/agent-runs/:id/second-opinion`, `POST /api/agent-runs/:id/cancel`, `POST /api/agent-runs/:id/approval`, `POST /api/agent-fleets`, `POST /api/agent-fleets/:id/cancel`
    - `/api/workspace-control/*`（ポリシー・ロック・イベント・チェックポイント等）
    - `POST /api/codex/rpc`（`thread/fork`）
  - 履歴検索（`src/session-search-query.mjs`, `src/session-control.ts`）:
    - **根拠なし**（検索専用のサーバー API ルートはなく、取得済みセッションに対するクライアント側フィルタとして実装）
- **対応するテストファイル**:
  - `test/session-control-reliability.test.mjs`, `test/session-control-security.test.mjs`, `test/session-control-ui-contract.test.mjs`, `test/session-search-query.test.mjs`, `test/session-tools.test.mjs`, `test/background-replay-timeout.test.mjs`
  - `test/agent-run-api.test.mjs`, `test/agent-run-service.test.mjs`, `test/agent-host-continuity.test.mjs`, `test/workspace-control.test.mjs`, `test/workspace-control-integration.test.mjs`, `e2e/unified-workspace-tabs.test.mjs`
- **未検証範囲**:
  - `POST /api/session-control/checkpoints`・`ownership`・`events` のサーバー統合テスト、および `server.mjs` を起動した `/api/session-control/*` の実 HTTP 統合テストは存在しません。
  - 実 OpenCode / 実 Codex プロセス障害・再起動時のハンドオフ・予算停止・再開はモック環境のみで検証されています。

### 7. Terminal

- **成熟度**: 実験的（`Experimental`）
- **根拠となる API ルート**:
  - `server.mjs`, `server/terminal.mjs`, `server/terminal-websocket.mjs`, `server/terminal-session-store.mjs`:
    - `GET /api/terminal/sessions`, `POST /api/terminal/sessions`
    - `POST /api/terminal/sessions/:id/claim`
    - `GET /api/terminal/sessions/:id`, `DELETE /api/terminal/sessions/:id`
    - `GET /api/terminal/sessions/:id/stream`
    - `POST /api/terminal/sessions/:id/input`
    - `POST /api/terminal/sessions/:id/socket-ticket`
    - WebSocket upgrade: `GET /api/terminal/sessions/:id/socket`
- **対応するテストファイル**:
  - `test/terminal-auth.test.mjs`, `test/terminal-persistence.test.mjs`, `test/terminal-sessions-security.test.mjs`, `test/terminal-websocket.integration.test.mjs`, `test/terminal-gate-flow.test.mjs`, `test/terminal-trusted-device-ui.test.mjs`, `test/tool-center-terminal.test.mjs`, `test/auth-server.integration.test.mjs`, `test/pairing-flow.integration.test.mjs`, `test/navigation-websocket-guard.test.mjs`
- **未検証範囲**:
  - 多くのテストは `fakePty` や偽 `tmux` ランナーを使用し、環境によっては実 `tmux` テストが skip されます（[docs/TERMINAL_SESSIONS.md](./TERMINAL_SESSIONS.md)）。
  - `systemd` ユーザーサービス再起動時の `tmux` 生存（現行 `KillMode=control-group` 制約）、macOS / Windows / WSL での動作、実モバイルブラウザのソフトウェアキーボード操作性は未検証です。

### 8. API Chat / Routing

- **成熟度**: 実験的（`Experimental`）
- **根拠となる API ルート**:
  - API Chat・添付（`server.mjs`, `server/multi-api.mjs`, `server/multi-api-attachments.mjs`）:
    - `GET /api/llm/presets`
    - `GET /api/llm/providers`, `POST /api/llm/providers`, `DELETE /api/llm/providers/:id`, `POST /api/llm/providers/:id/migrate-to-vault`
    - `POST /api/llm/test`
    - `POST /api/llm/attachments`, `DELETE /api/llm/attachments/:id`
    - `POST /api/llm/chat`
  - モデルルーティング・フェイルオーバー（`server/advanced-api.mjs`, `server/advanced-features.mjs`, `src/model-routing.mjs`）:
    - `GET /api/advanced/models`, `POST /api/advanced/models/run`, `GET /api/advanced/providers`
- **対応するテストファイル**:
  - `test/multi-api.test.mjs`, `test/multi-api-v3-integration.test.mjs`, `test/multi-api-vault-integration.test.mjs`, `test/api-chat-conversations.test.mjs`, `test/api-chat-overlays.test.mjs`, `test/api-attachment.test.mjs`, `test/api-model-label.test.mjs`, `test/model-routing.test.mjs`, `test/advanced-features.test.mjs`, `test/advanced-navigation-ui.test.mjs`
- **未検証範囲**:
  - テストは `fetch` モックによる検証であり、実外部プロバイダ（OpenAI, Gemini, Anthropic, OpenRouter, DeepSeek, Ollama 等）に対する疎通・画像添付互換性・障害時フェイルオーバーの挙動は実環境未検証です。

### 9. Qwen Code

- **成熟度**: 実験的・ローカルに Qwen Code CLI が必要（`Experimental; requires a locally installed Qwen Code CLI`）
- **根拠となる API ルート**:
  - `server.mjs`, `server/qwen-chat.mjs`, `server/qwen-models.mjs`, `server/qwen-code-providers.mjs`, `server/integrations.mjs`:
    - `POST /api/qwen/chat`
    - `GET /api/qwen/models`
    - `POST /api/qwen/providers`
    - `POST /api/qwen/chat/cancel`
    - `POST /api/integrations/qwen/launch`, `POST /api/integrations/status`
- **UI ゲート（既定状態）**:
  - `src/feature-flags.mjs` の `QWEN_UI_ENABLED = false` により、Qwen Code の UI サーフェスは既定で無効化されています（有効化しない限り、`src/unified-workspace-nav.ts`・`src/app-shell.ts` の AI セレクター、`src/surface-navigation.mjs`・`src/main.ts` のナビゲーション、および `src/integrations.ts` の Local Integrations UI から非表示となります）。
- **対応するテストファイル**:
  - `test/qwen-chat.test.mjs`, `test/qwen-models.test.mjs`, `test/qwen-chat-ui.test.mjs`, `test/qwen-ui-gate.test.mjs`, `test/integrations-ui.test.mjs`, `test/integration-launch-contracts.test.mjs`, `test/integration-launch-210.test.mjs`
- **未検証範囲**:
  - **既定 UI 非公開（UI ゲート）**: 上記のとおり `src/feature-flags.mjs` で `QWEN_UI_ENABLED = false` が設定されているため、通常の既定 UI からは AI セレクター・ナビゲーション・Local Integrations UI のいずれからも Qwen Code を選択・起動できません。
  - テストは偽ストリームランナー・一時ディレクトリ上の `.qwen/settings.json`・UI モック `fetch` による検証であり、`server.mjs` HTTP サーバーを起動して `/api/qwen/*` を叩く統合テストはありません。
  - ローカルにインストールされた実際の `qwen` CLI 各バージョンおよび各プロバイダ設定でのチャット・再開（`--resume`）・端末起動（「PCで開く」）は実環境未検証です。

### 10. Developer Workflows

- **成熟度**: 機能ごとに異なる（`Mixed; see docs`）
- **根拠となる API ルート**:
  - `server.mjs`, `server/dev-workflows.mjs`, `server/acp-adapter.mjs`:
    - `GET /api/dev/settings`, `PUT /api/dev/settings`
    - `GET /api/dev/session-context`（Skills / Rules 解決）
    - `GET /api/dev/capabilities`（ネイティブ Adapter + 任意 ACP 折衝、Extension 承認状態）
    - `POST /api/dev/extension/approve`
    - `POST /api/dev/review`, `POST /api/dev/review/comment`
    - `POST /api/dev/ci`
    - `POST /api/dev/verify`, `POST /api/dev/repair`
    - `POST /api/dev/acp/probe`
    - `POST /api/dev/mcp/test`, `POST /api/dev/mcp`, `PUT /api/dev/mcp/enabled`, `DELETE /api/dev/mcp`
  - 関連する Subagent / Agent Run 実行基盤（`server.mjs`, `server/agent-run-service.mjs`, `server/agent-run-api.mjs`）:
    - `GET /api/agent-runs`, `POST /api/agent-runs`, `GET /api/agent-runs/events`, `POST /api/agent-runs/:id/second-opinion`, `POST /api/agent-runs/:id/cancel`, `POST /api/agent-runs/:id/approval`, `POST /api/agent-fleets`, `POST /api/agent-fleets/:id/cancel`
- **対応するテストファイル**:
  - `test/dev-workflows.test.mjs`（`validateExtensionManifest`, `normalizeDevWorkflowSettings`, `maskSecrets`, `structureMcpResult`, `negotiateAdapter`, `getSettings`/`updateSettings`, `capabilities`, `approveExtension`, symlink 拒否）
  - `test/developer-workflow-hardening.test.mjs`, `test/acp-adapter.test.mjs`, `test/agent-run-api.test.mjs`, `test/agent-run-service.test.mjs`, `test/agent-host-continuity.test.mjs`, `test/subagent-runtime.test.mjs`, `test/sheet-theme-frame.test.mjs`, `test/ui-audit-regressions.test.mjs`
- **未検証範囲**:
  - `/api/dev/*` 全ルートに対する実 HTTP サーバー統合テストはありません。
  - `sessionContext`（Skills/Rules マージ）、`review`、`postReviewComment`、`ciStatus`、`runVerification`、`repair`、`probeAcp`、`testMcpServer`、`saveMcpServer` は単体/統合テストで直接呼び出されていません。
  - 実 ACP エージェント、実 GitHub PR コメント投稿・CI 取得（`gh`）、実 Codex レビュー/修復ターンは未検証です。また `devmoter.extension.json` はマニフェスト検証・承認管理のみで、拡張コードの実行ランタイムは実装されていません（[docs/developer-workflows.md](./developer-workflows.md)）。

### 11. Host Protocol

- **成熟度**: v1 探索契約・Adapter ごとに差あり（`v1 discovery contract; adapters vary`）
- **根拠となる API ルート**:
  - `server.mjs`, `server/host/protocol.mjs`, `server/host/adapters.mjs`:
    - `GET /api/host`
- **対応するテストファイル**:
  - `test/host-protocol.test.mjs`
  - `test/auth-server.integration.test.mjs`（`GET /api/host` の認証境界と応答検証）
  - `test/mission-control.test.mjs`
- **未検証範囲**:
  - Linux 以外の OS アダプタ（`MacOSHost` は全機能 `macos_adapter_not_implemented`、`WindowsWSLHost` は WSL 外で `wsl_engine_not_connected`、WSL 内では `terminal` の既定が `wsl_terminal_not_implemented`）は CI の Linux 環境上で実機検証されていません。
  - `server.mjs` の `hostRuntime` 登録では `processes`・`services`・`ports`・`browser` の 4 機能群が `unavailable`（`not_implemented`）として返ります（[docs/HOST_PROTOCOL.md](./HOST_PROTOCOL.md)）。

### 12. Automation / Integrations

- **成熟度**: 実験的（`Experimental`）
- **Command hooks**: fail closed without bubblewrap and a registered project boundary,
  including events without `projectId`. `DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1` explicitly
  permits unsandboxed execution unless `DEVMOTER_SANDBOX=required`. Decisions and results
  are recorded in `~/.config/opencode-pocket/hook-audit.jsonl`; see
  [command lifecycle hooks](./BROWSER_AUTOMATION_SANDBOX.md#command-lifecycle-hooks).
- **根拠となる API ルート**:
  - Control Plane（`server.mjs`, `server/control-plane.mjs`）:
    - `GET /api/control/hosts`, `GET /api/control/hosts/status`, `POST /api/control/hosts`, `DELETE /api/control/hosts/:id`
    - `GET /api/control/schedules`, `POST /api/control/schedules`, `PATCH /api/control/schedules/:id`, `DELETE /api/control/schedules/:id`, `POST /api/control/schedules/preview` (read-only: validates and returns target, upcoming run times and approval policy; saves and runs nothing)
    - `GET /api/control/triggers`, `POST /api/control/triggers`, `DELETE /api/control/triggers/:id`
    - `GET /api/control/runs[?result=success|failed|running]` (failed runs carry a server-redacted `failureReason`, `null` when none was recorded), `POST /api/control/runs/:id/retry` (failed schedule/trigger runs only; requires `{ "confirm": true }`, never automatic), `POST /api/control/autopilot`, `POST /api/control/autopilot/:id/(pause|resume|cancel)`
    - `POST /api/control/events/github`（GitHub Webhook HMAC 受信）
  - Automation API v1（`server/automation-api.mjs`, `server/context-references.mjs`）:
    - `GET /api/automation/projects`, `GET /api/automation/open`, `GET /api/automation/sessions`, `POST /api/automation/tasks`, `GET /api/projects/:id/context`, `POST /api/projects/:id/context/resolve`
  - User Automation（`server.mjs`, `server/user-automation.mjs`）:
    - `GET /api/user-automation`, `PUT /api/user-automation`, `GET /api/user-automation/slash`, `POST /api/user-automation/slash/resolve`, `GET /api/user-automation/recipes`, `POST /api/user-automation/recipes/:id/run`, `GET /api/user-automation/runs/:id`, `POST /api/user-automation/runs/:id/cancel`
  - ローカル連携・CLI・ブラウザサンドボックス（`server.mjs`, `server/integrations.mjs`, `server/cli-launch.mjs`, `server/advanced-api.mjs`, `server/browser-tool.mjs`）:
    - `POST /api/integrations/status`, `POST /api/integrations/(antigravity|claude|qwen)/launch`, `POST /api/integrations/antigravity/remote/(start|stop)`, `GET /api/cli`
    - `GET /api/advanced/sandbox`, `GET /api/advanced/browser`, `POST /api/advanced/browser/(start|inspect|stop)`, `GET /api/advanced/grants`, `POST /api/advanced/grants`, `DELETE /api/advanced/grants/:id`
- **対応するテストファイル**:
  - `test/control-plane-v3.test.mjs`, `test/remote-auth-boundary.test.mjs`, `test/remote-automation-security.test.mjs`, `test/automation-api-v3.test.mjs`, `test/automation-client-v3.test.mjs`, `test/automation-routing-v3.test.mjs`, `test/automation-ui-regression.test.mjs`, `test/context-references-v3.test.mjs`, `test/context-attachments-v3.test.mjs`, `test/user-automation.test.mjs`
  - `test/integration-launch-210.test.mjs`, `test/integration-launch-contracts.test.mjs`, `test/integrations-security.test.mjs`, `test/integrations-ui.test.mjs`, `test/cli-launch.test.mjs`, `test/browser-tool.test.mjs`, `test/auth-server.integration.test.mjs`, `test/codex-not-installed.test.mjs`
- **未検証範囲**:
  - `POST /api/control/events/github`（GitHub Webhook）を含む `/api/control/*`、`/api/projects/:id/context*` の HTTP サーバー統合テストは存在しません（`test/control-plane-v3.test.mjs` は `ControlPlane.dispatchEvent(...)` 等のインプロセス単体テスト、`test/remote-auth-boundary.test.mjs`・`test/remote-automation-security.test.mjs` は `server.mjs` の静的文字列チェックのみ）。`/api/user-automation*` は、破損した監査行があっても `GET /api/user-automation` が成功するケースのみ HTTP 統合テストで検証しています。
  - 実 Chromebook/Crostini 環境での Antigravity 起動（#210）、実 Claude Code / Antigravity リモート連携、実 GitHub Webhook 配信、複数ホスト間の実Tailscale通信は未検証です。

### 13. Web / PWA

- **成熟度**: 実装済み（`Shipped`）
- **根拠となる API ルート**:
  - `server.mjs` / `public/` / `index.html` / `src/`:
    - 認証不要公開アセット（`PUBLIC_STATIC_PATHS`）: `GET/HEAD /manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png`, `/sw.js`
    - ログイン画面アセット（`LOGIN_ASSETS`）: `GET/HEAD /login.html`, `/login.js`
    - アプリシェル配信・ヘルス: `serveStatic`, `GET /api/health`
    - 端末・Push・診断補助（`server/system-features.mjs`）: `/api/system/diagnostics`, `/api/devices*`, `/api/pairings*`, `/api/push/*`
- **対応するテストファイル**:
  - `test/pwa-backend.integration.test.mjs`, `test/pwa-public-assets.test.mjs`, `test/index-html-pwa-meta.test.mjs`, `test/service-worker-cache-lifecycle.test.mjs`, `test/security-headers.test.mjs`, `test/login-assets-no-build.test.mjs`, `test/login-ui.test.mjs`
  - `test/mobile-overflow-css.test.mjs`, `test/unified-ui-default.test.mjs`, `test/unified-workspace-nav.test.mjs`, `test/unified-workspace-chat.test.mjs`, `test/unified-feature-shell.test.mjs`, `test/pairing-flow.integration.test.mjs`, `test/push-readiness.test.mjs`, `test/wake-lock.test.mjs`
  - `e2e/codex-layout.test.mjs`, `e2e/unified-workspace-tabs.test.mjs`, `scripts/test-opencode-navigation.mjs`
- **未検証範囲**:
  - CI のブラウザ検証はデスクトップ環境上の Playwright WebKit / JSDOM であり、実 iPhone Safari（「ホーム画面に追加」、ソフトウェアキーボード、safe-area、バックグラウンド復帰後の再接続）および実 Chromebook/Android でのインストール動作は [RELEASE_SMOKE.md](../RELEASE_SMOKE.md) による手動検証が必要です。

### 14. iOS Client

- **成熟度**: 実験的・実機検証が必要（`Experimental; device validation required`）
- **根拠となる API ルート**:
  - **根拠なし**（専用の backend API ルートは存在しません。既存の DevMoter サーバーへ HTTPS で接続する SwiftUI + `WKWebView` ラッパーです）
- **対応するテストファイル**:
  - **根拠なし**（`test/`・`e2e/` 配下に自動テストはありません。ビルド確認は `.github/workflows/ios-altstore.yml` による `macos-15` 上の `xcodegen` / `xcodebuild` および未署名 `DevMoter-AltStore.ipa` 生成のみ）
- **実装ファイル**:
  - `ios/DevMoter/DevMoterApp.swift`, `ios/project.yml`, `.github/workflows/ios-altstore.yml`
- **未検証範囲**:
  - 実 iPhone での署名・インストール（AltStore Classic / SideStore / iloader）、HTTPS/Tailscale 接続、接続プロファイルごとの `WKWebsiteDataStore` Cookie 分離、無効証明書・非 HTTPS 拒否、OAuth/Passkey リダイレクト、アプリ再起動後のセッション維持は実機未検証です（[docs/ios-altstore.md](./ios-altstore.md), [docs/iphone-linux.ja.md](./iphone-linux.ja.md)）。

---

## README.zh-CN.md（v2 表・16 行）との対応

[README.zh-CN.md](../README.zh-CN.md) の「功能状态」表は v2 構成の 16 行を残しているため、全言語版の整合対象として以下に根拠を対応づけます。

| README.zh-CN.md 行 | 状態 | 根拠となる API ルート | 対応するテストファイル | 備考・未検証範囲 |
| --- | --- | --- | --- | --- |
| OpenCode | ✅ Shipped | `/api/opencode/*`, `/api/health` | `test/opencode-adapter-routes.integration.test.mjs`, `test/backend-integration.test.mjs`, `test/pwa-backend.integration.test.mjs` ほか | #1 Agent Workspace 参照 |
| Codex | ✅ Shipped | `/api/codex/*`, `/api/health` | `test/codex-bridge.test.mjs`, `test/backend-integration.test.mjs`, `test/auth-server.integration.test.mjs` ほか | #1 Agent Workspace 参照 |
| Projects | ✅ Shipped | `/api/projects`, `/api/projects/:id/*` | `test/auth-server.integration.test.mjs`, `test/server-smoke.test.mjs`, `test/advanced-features.test.mjs` ほか | #2 Projects 参照 |
| GitHub workspace | **🧪 Experimental** | `/api/github/*` | `test/github.test.mjs`, `test/github-managed-path.test.mjs`, `test/github-picker-regression.test.mjs` | 今回 `✅ Shipped` から引き下げ（#3 参照） |
| Session control | 🧪 Experimental | `/api/session-control/*`, `/api/agent-runs*`, `/api/agent-fleets*` | `test/session-control-reliability.test.mjs`, `test/session-control-security.test.mjs`, `test/session-search-query.test.mjs` ほか | #6 Session Control 参照 |
| Reviewed Changes / Tasks | 🧪 Experimental | `/api/workflow/projects/:projectId/*` | `test/task-workflow.test.mjs`, `test/review-overlay-ui.test.mjs` | #5 Reviewed Changes 参照 |
| Project context / local index | 🧪 Experimental | `/api/projects/:id/index/*`, `/api/projects/:id/map`, `/api/projects/:id/context`, `/api/projects/:id/context/resolve`, `/api/knowledge/notes*` | `test/project-index.test.mjs`, `test/tools-ai-server.integration.test.mjs`, `test/context-references-v3.test.mjs`, `test/context-attachments-v3.test.mjs`, `test/knowledge-store.test.mjs` | 非 Linux や大規模リポジトリでのインデックス性能は実機未検証 |
| Persistent terminal | 🧪 Experimental | `/api/terminal/sessions*`, WebSocket `/api/terminal/sessions/:id/socket` | `test/terminal-persistence.test.mjs`, `test/terminal-websocket.integration.test.mjs`, `test/terminal-sessions-security.test.mjs` ほか | #7 Terminal 参照 |
| API Chat / model routing | 🧪 Experimental | `/api/llm/*`, `/api/advanced/models*`, `/api/advanced/providers` | `test/multi-api*.test.mjs`, `test/model-routing.test.mjs`, `test/advanced-features.test.mjs` ほか | #8 API Chat / Routing 参照 |
| Automation / control plane | 🧪 Experimental | `/api/control/*`, `/api/automation/*`, `/api/user-automation*` | `test/control-plane-v3.test.mjs`, `test/automation-api-v3.test.mjs`, `test/user-automation.test.mjs` ほか | #12 Automation / Integrations 参照 |
| Antigravity / Claude 集成 | 🧪 Experimental | `/api/integrations/status`, `/api/integrations/(antigravity\|claude)/launch`, `/api/integrations/antigravity/remote/(start\|stop)` | `test/integration-launch-210.test.mjs`, `test/integration-launch-contracts.test.mjs`, `test/integrations-security.test.mjs`, `test/auth-server.integration.test.mjs` | Chromebook/Crostini 実機起動（#210）未検証 |
| PWA / mobile UI | ✅ Shipped | `/manifest.webmanifest`, `/sw.js`, `/icon-*.png`, `/apple-touch-icon.png`, `/login.*`, `/api/health` | `test/pwa-backend.integration.test.mjs`, `test/pwa-public-assets.test.mjs`, `test/index-html-pwa-meta.test.mjs`, `e2e/*.test.mjs` ほか | #13 Web / PWA 参照 |
| Passkey / device controls | 🧪 Experimental | `/api/auth/passkey/*`, `/api/devices*`, `/api/pairings*` | `test/passkey-auth-v3.test.mjs`, `test/passkey-owner-session.test.mjs`, `test/auth-v2-server.integration.test.mjs`, `test/pairing-flow.integration.test.mjs` | 実機 WebAuthn / iOS Safari WKWebView でのパスキー動作未検証 |
| Library | 🗺️ Planned | **根拠なし** | **根拠なし** | 未実装（[ROADMAP.md](../ROADMAP.md) に計画中として明記） |
| Google / Microsoft 登录 | ✅ Available | `POST /api/auth/(google\|microsoft)/start`, `GET /api/auth/(google\|microsoft)/callback`, `POST /api/auth/providers/(google\|microsoft)/disconnect` | `test/oidc-auth.test.mjs`, `test/auth-v2-server.integration.test.mjs` | ホスト側 OAuth アプリ設定が必要。実プロバイダ環境での本番検証はホスト依存（[ROADMAP.md](../ROADMAP.md), [docs/auth-v2.md](./auth-v2.md)） |
| Apple 登录 | 🗺️ Planned | **根拠なし** | **根拠なし** | 未実装（[ROADMAP.md](../ROADMAP.md) に計画中として明記） |
