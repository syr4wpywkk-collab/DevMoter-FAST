# DevMoter FAST — Product Spec

## One sentence

OpenCode / Codex を iPhone から「チャット・進捗・承認・diff」に絞って操作する、超軽量 Remote Control。

## Principle

**Remote Control, not Remote IDE.**

デスクトップ UI をスマホへ移植するのではなく、外出先で必要な操作だけを残す。

## Backends

### OpenCode
- localhost HTTP API を DevMoter backend が proxy
- OpenCode 自体は外部へ公開しない

### Codex
- DevMoter backend が `codex app-server --listen stdio://` を管理
- stdio JSONL / app-server protocol を利用
- 既存 Codex CLI 認証を利用
- frontend へ API key を渡さない

## Core screens

1. Connection
2. Session
3. Chat / Activity
4. Permission
5. Model
6. Git diff

基本は1画面。

## Non-goals

- フルIDE
- ファイルエクスプローラー
- ターミナルエミュレータ
- ブラウザ上のコード編集
- Git push/reset/delete
- OpenCode / Codex 本体の置き換え
- app-server の直接インターネット公開

## Security baseline

- DevMoter: 127.0.0.1 bind
- OpenCode: 127.0.0.1 only
- Codex: stdio only
- external access は DevMoter 経由
- destructive helper API を作らない
- approval はユーザーへ表示
- secrets を browser bundle / log に出さない
