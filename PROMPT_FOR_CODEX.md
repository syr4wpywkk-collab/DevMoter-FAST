# Codex handoff — DevMoter FAST v0.2

このリポジトリは、OpenCode と Codex を iPhone から軽快に操作する Remote Control PWA です。

## 現在の状態

Codex backend は実装済みです。

Architecture:

```text
iPhone
  ↓
DevMoter FAST
  ├─ localhost proxy → OpenCode
  └─ CodexBridge → stdio → codex app-server
```

Codex 側では:

- initialize handshake
- thread/list
- thread/start
- thread/resume
- turn/start
- event streaming
- command / file approval

まで実装されています。

## 最優先

既存コードと公式の現行 API 仕様を **推測せず** 確認してください。

Codex は app-server の stable API を優先し、experimental API を使う場合は理由を明記してください。

OpenCode はローカルの `GET /doc` / OpenAPI specification を確認してから実装してください。

## Next tasks

### 1. Quality / tests
- CodexBridge の unit tests
- malformed JSONL / process exit / timeout
- RPC allowlist
- approval lifecycle
- frontend typecheck / build

### 2. Codex history
- thread/read(includeTurns=true)
- persisted user / agent messages を transcript に表示
- resumed thread の live events と重複させない

### 3. Server requests
- tool/requestUserInput
- permissions approval
- MCP elicitation
- unsupported request を放置せず、安全に扱う

### 4. Model picker
- model/list
- 選択モデルを thread / turn に適用
- 利用不能モデルをハードコードしない

### 5. Git read-only
- branch
- status
- diff
- push / reset / delete は実装しない

### 6. OpenCode
- /doc を確認
- sessions
- messages
- /event SSE
- permissions
- provider/model

### 7. Security
- DevMoter server 自身の認証
- Tailscale 前提でも browser/session レベルの防御を追加
- secrets を frontend bundle / log に出さない
- Codex / OpenCode の直接公開は禁止

### 8. Runtime
- systemd user service
- Codex / DevMoter 自動復帰
- Chromebook / Crostini 向け one-shot installer

## UX constraints

iPhone Safari 優先。

- 44px以上のtap target
- safe-area
- prompt下部固定
- dark mode
- animation最小
- 片手操作
- 画面遷移を減らす
- 重いframeworkを追加しない

## Development constraints

既存:
- Vanilla TypeScript
- Vite
- Node built-ins

大きな framework / UI library / runtime dependency を追加する前に、本当に必要か判断してください。

## Git workflow

main を直接書き換えず、feature branch で作業して PR を作成してください。

最後に:

- 実装機能
- 使用 API
- 起動方法
- security notes
- 未実装項目
- test 結果

を README / PR に反映してください。
