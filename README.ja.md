# DevMoter FAST

**AI コーディングエージェントを、どこからでも。📱**

[English](./README.md) | **日本語** | [简体中文](./README.zh-CN.md)

DevMoter FAST は、**Codex と OpenCode をスマホ・タブレット・PC のブラウザから操作するための mobile-first なリモート UI** です。コーディングエージェント本体は Linux ホスト上で動作し、ブラウザは DevMoter を経由して操作します。

**Codex + OpenCode · PWA · English / 日本語 / 简体中文 · Open source**

> [!IMPORTANT]
> DevMoter FAST は **実験的な非公式コミュニティプロジェクト** です。OpenAI、OpenCode、その他ソフトウェア内で参照される上流プロジェクトや提供元とは提携しておらず、承認・推奨を受けたものでもありません。

> [!WARNING]
> DevMoter は **単一ユーザーのプライベートホスト / プライベートネットワーク** を前提にしています。DevMoter 自体の HTTP ログインを必須にしていますが、これはプライベート環境向けの単一ユーザー境界であり、公開 SaaS 向けの認可システムではありません。DevMoter、OpenCode、エージェント backend を公開インターネットへ直接露出させないでください。

## はじめに

- ⚡ **高速インストール:** [fastinstall.MD](./fastinstall.MD)
- 🔐 **セキュリティと脆弱性報告:** [SECURITY.md](./SECURITY.md)
- 📜 **サードパーティ通知:** [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

> [!CAUTION]
> **Alpha セキュリティ通知:** セキュリティレビューは継続中です。既知の制約があるため、信頼できるプライベートネットワークでのみ使用してください。脆弱性を見つけた場合、攻撃手順や秘密情報を公開 Issue に投稿せず、[SECURITY.md](./SECURITY.md) に従ってください。

## DevMoter でできること

- OpenCode のセッション、モデル、エージェント、コマンド、スキル、ライブイベント、権限確認、割り込み
- Codex のスレッド履歴、新規 / 再開 / fork、モデル選択、推論強度、ストリーミング、承認、添付ファイル
- プロジェクト登録・作成、作業ディレクトリ選択、安全な Markdown 閲覧・編集
- ホスト側の `gh` セッションを利用した GitHub リポジトリ操作
- モバイル向け PWA
- English / 日本語 / 简体中文 の UI
- Node テスト、coverage、build、GitHub Actions CI

DevMoter FAST は現在 **Alpha / active development** です。プロトコル変更、UI の粗さ、上流バージョン依存の互換性問題が起こる可能性があります。

## クイックスタート

### 必要なもの

Linux 環境に次を用意してください。

- Node.js / npm
- OpenCode CLI
- OpenAI Codex CLI
- Python 3
- `curl`

GitHub リポジトリ機能を使う場合は GitHub CLI をインストールし、自分のアカウントで認証します。

```bash
gh auth login
gh auth status
```

各コーディングエージェントの CLI は、上流ツールが提供する正式な手順で事前に認証・設定してください。

### 上流サービスのアカウントと利用規約

DevMoter FAST は、上流サービスのアカウント、サブスクリプション、API キー、ログイントークン、その他の認証情報を提供・販売・共有・同梱しません。

利用者はそれぞれ、

- 自分が利用資格を持つアカウントを使用する
- 上流ツールがサポートする認証フローを使用する
- 適用される利用規約、年齢要件、ポリシー、アカウントルールを守る
- 他人の認証情報を共有・借用しない

必要があります。

### 1. Clone

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
```

### 2. 起動

```bash
bash scripts/start-pocket.sh
```

既定のローカルエンドポイント:

```text
DevMoter:  http://127.0.0.1:8787
OpenCode:  http://127.0.0.1:49374
```

Codex app-server は公開ソケットではなく、DevMoter からローカル stdio 経由で起動・通信します。

DevMoter の既定ユーザー名は `devmoter` です。ランチャーが生成したパスワードは `~/.config/opencode-pocket/devmoter-auth-password` に owner-only 権限で保存され、初回アクセス時にブラウザがログインを求めます。

## スマホからのプライベートアクセス

DevMoter 自体は localhost に bind したまま使う設計です。Tailscale Serve を使う例:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

同じ tailnet に参加している端末から、表示された HTTPS URL を開きます。

> [!CAUTION]
> DevMoter の HTTP ログインがあっても、public tunnel や Tailscale Funnel での公開は現在の Alpha では推奨しません。localhost + HTTPS の Tailscale Serve など、プライベートネットワーク経由で利用してください。

## アーキテクチャ

```text
Phone / tablet / desktop browser / PWA
                  │
                  │ HTTPS via Tailscale Serve (optional)
                  ▼
          DevMoter FAST :8787
            127.0.0.1 default
              │       │
              ▼       ▼
          OpenCode   Codex
            HTTP     stdio
          :49374   app-server
              │       │
              └───┬───┘
                  │
             local projects
```

ブラウザにエージェントの資格情報を渡すのではなく、バックエンドのプロセス・ローカルパス・資格情報はホスト側に保持します。

## セキュリティモデル

主な境界:

- DevMoter は既定で `127.0.0.1` に bind
- DevMoter 独自の HTTP ログインを必須化
- 状態変更リクエストは同一 Origin を検証
- API 応答は `no-store`、設定済み秘密情報はエラー応答からマスク
- OpenCode も localhost
- Codex app-server は stdio
- バックエンド資格情報はサーバー側
- Codex RPC は allowlist
- プロジェクトパスをユーザーの home 配下に制限
- モバイルエディタからの書き込みは登録済みプロジェクト内の Markdown に制限
- GitHub トークンはブラウザへ返さない

**重要:** DevMoter のログインは単一ユーザー向けのアクセス境界です。ログイン後のクライアントはエージェントに与えられた権限で操作できます。リモート利用では HTTPS を使い、推奨構成の localhost + Tailscale Serve を維持してください。reverse proxy で外部 Origin が変わる場合は `DEVMOTER_PUBLIC_ORIGIN` を明示します。

## テスト

```bash
npm test
npm run test:coverage
npm run build
```

GitHub Actions でも自動チェックを実行します。実アカウントが不要な backend safety / bridge / compatibility テストをできるだけ CI に含めています。

## 開発

```bash
npm install
npm run dev:server
```

別ターミナル:

```bash
npm run dev:web
```

現在の package version: **0.2.0**

## 互換性

DevMoter は OpenCode と Codex app-server の上流プロトコルを利用しているため、上流の変更によって互換性が壊れる場合があります。Issue を報告する際は DevMoter commit、OpenCode / Codex のバージョン、ブラウザ環境、エラー内容を添えてください。

## コントリビューション

Issue、バグ報告、互換性情報、ドキュメント改善、Pull Request を歓迎します。

公開 Issue に API キー、ログイントークン、Tailscale の資格情報、生成された OpenCode password、DevMoter login password などの秘密情報を投稿しないでください。

## AI-assisted development

このプロジェクトは AI を大きく活用して開発されています。実装、デバッグ、プロトコル調査、テスト、反復に AI を利用していますが、製品方針、要件、実機テスト、リリース判断、保守は人間が管理します。

## ライセンス

DevMoter FAST は **MIT License** です。[LICENSE](./LICENSE) を参照してください。
