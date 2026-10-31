# DevMoter FAST

**AI開発エージェントと開発環境を、一つのコントロールプレーンへ。**  
エージェントや開発ツールは自分のマシンで動かす。操作・連携・レビューは、手元のスマートフォンから。

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

[English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

> **製品世代:** v3.0.0-alpha  
> **リリース状態:** 開発中 / プレリリース  
> **npm package version:** `0.2.0`（private package metadata。製品世代とは独立）

DevMoter FASTは、**AIを活用したソフトウェア開発のための、オープンソース・セルフホスト・モバイルファーストなコントロールプレーン**です。

コーディングエージェント、Projects、Gitワークフロー、変更レビュー、開発者ツール、ホスト連携を一つのワークスペースにまとめながら、実行環境と認証情報は自分が管理するマシンに保持します。

これは単なる遠隔チャットUIの機能追加ではありません。DevMoterは、ユーザー・コーディングエージェント・リポジトリ・実行ホストの間をつなぐ、開発運用レイヤーへと再設計されています。

> [!IMPORTANT]
> DevMoter FASTは独立したコミュニティプロジェクトです。OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscaleその他の記載された提供元とは、提携・スポンサー・承認関係にありません。

> [!WARNING]
> 現在のセキュリティモデルは **単一所有者・ホストローカル運用** を前提としています。サーバーはlocalhostにbindし、リモートアクセスにはTailscaleなどのプライベートネットワークを利用してください。DevMoter、Agent backend、ホスト制御APIを公開インターネットへ直接公開しないでください。

## DevMoterが目指すもの

開発マシンは、実際に処理を実行する場所です。DevMoterは、その操作と連携を担うコントロールレイヤーです。

- **ユーザー**が目的を決め、重要な操作を承認する。
- **Agent**がコーディング、調査、対応するワークフローを実行する。
- **Projects**がリポジトリと開発コンテキストへの登録済み・限定的なアクセスを提供する。
- **Review / Git workflow**が変更を適用する前に可視化する。
- **Host**がプロセス、ファイル、認証情報、ローカル連携を管理する。
- **スマートフォンやブラウザ**がモバイルファーストの操作面になる。

目標は明確です。

**開発環境は動かしたまま、そのコントロールプレーンを持ち歩く。**

## 統合する機能

| 領域 | 機能 | 成熟度 |
| --- | --- | --- |
| Agent Workspace | OpenCode / Codexのセッション、ストリーミング、モデル・Agent選択、承認、割り込み | 実装済み・上流依存 |
| Projects | Project登録、切替、制限付きファイル・Markdownアクセス | 実装済み |
| GitHub Workspace | ホスト認証を使ったRepository検索と管理対象Repository操作 | 実装済み・範囲限定 |
| Tools AI | 自然言語の目的を、制限されたProject / Host観測へルーティング | 実験的 |
| Reviewed Changes | Diff提案、ファイル・Hunkレビュー、Context drift確認、明示的Apply / Commit | 実験的 |
| Session Control | Follow-up、Handoff、Checkpoint、Fork、履歴検索、Background run制御 | 実験的 |
| Terminal | 認証付きProject単位の永続Terminal、出力制限、再接続 | 実験的 |
| API Chat / Routing | Provider / Model設定、Reasoning制御、添付、Routing / Failover | 実験的 |
| Developer Workflows | Skills、Rules、MCP管理、任意ACP、Extension、検証・レビュー設定 | 機能ごとに異なる |
| Host Protocol | Host adapterのバージョン付きCapability discovery | v1探索契約・Adapterごとに差あり |
| Automation / Integrations | Host registry、制限付きTrigger / Schedule、一部Integration handoff | 実験的 |
| Web / PWA | レスポンシブなモバイルUI、インストール可能なWeb shell | 実装済み |
| iOS Client | 既存DevMoterサーバーへHTTPS接続するNative wrapper | 実験的・実機検証が必要 |

**成熟度の表記は重要です。**「実装済み」は実際のbackend経路があること、「実験的」は実装済みだが追加の堅牢化・検証が必要なこと、「計画中」はまだ提供機能ではないことを示します。UIにボタンがあることや設計書が存在することだけでは、機能の動作を保証しません。

## システム構成

```text
 スマホ · タブレット · Browser · PWA · iOS client
                       │
                       │ private HTTPS
                       ▼
             ┌──────────────────────┐
             │     DevMoter FAST    │
             │ Auth · UI · Routing  │
             │ Projects · Reviews  │
             │ Host capability API │
             └──────────┬───────────┘
                        │
             ┌──────────┼───────────┐
             ▼          ▼           ▼
          OpenCode    Codex      API providers
          localhost   stdio        HTTPS
             │          │           │
             └──────────┼───────────┘
                        ▼
          Projects · Git · Tools · Tasks
           Terminal · Integrations · State
                        │
                        ▼
                 自分のHost machine
```

ブラウザは、無制限の権限を持つ遠隔Shellではなくコントローラーです。認証済みの制限されたリクエストを送り、特権リソースの解決と検証はサーバー側で行います。Agent process、Repository data、ローカルパス、Provider credentialは、連携方式が許す限りホスト側に保持されます。

## 典型的なワークフロー

1. Projectを登録または選択する。
2. 対応するAgent sessionを開始・再開する。
3. ホスト上でAgentを動かしながら、スマートフォンやブラウザから操作する。
4. 進捗、Tool activity、制限されたProject contextを確認する。
5. 対応機能に応じてInterrupt、Follow-up、Handoffを行う。
6. 提案されたDiffを確認し、Context driftを検証する。
7. 対応するworkflowで、承認した変更を明示的にApply / Commitする。
8. GitHubや設定済みの検証・レビュー機能へ進む。

すべての機能が同じ成熟度ではありません。実験的なworkflowを利用する前に、機能ステータスと各仕様書を確認してください。

## Agent / Developer surfaces

### OpenCode

localhost上のOpenCode runtimeへ接続し、backend認証情報をブラウザへ返さない構成です。Session、Agent、Provider / Model選択、Mode、Command、Skill、Streaming activity、Permission request、Question、Interruptなどを扱います。利用可能な機能はインストール済みOpenCodeのバージョンに依存します。

### Codex

ローカルCodex app-serverとstdio/JSONLで通信します。Thread、History、Resume / Fork、Streaming turn、Interrupt、Approval、Attachment、Dynamic model discovery、Reasoning effort、Plugin / MCP inventoryなどに対応します。RPCアクセスはserver-side allowlistで制限し、認証はローカルCodex CLIが保持します。

### API Chat / Model Routing

実験的なAPI Chatは、設定済みProvider / Model、Reasoning control、Attachment、Routing / Failoverを扱います。Provider credentialはserver-sideに保存され、設定後にfrontendへ返されません。

### Projects / Git / Reviewed Changes

ブラウザから任意の作業ディレクトリを渡すのではなく、登録済みProject IDを利用します。Project操作はserver-sideのpath checkで制限されます。GitHub Workspaceはホストの認証済み`gh` sessionを利用し、管理対象パスやworktreeの安全性を確認します。

実験的なReview workflowは、変更を見える状態に保つことを重視します。

- 変更を提案する
- ファイル単位・Hunk単位で確認する
- 元のContextからずれていないか検証する
- 承認した変更だけを明示的にApplyする
- Commit前に検証する
- 対応範囲で管理対象WorktreeやPR workflowを使う

### Tools AI / Local Context

Tools AIは自然言語の目的を受け取り、Git変更、保存済みIndexの検索、Project map、Markdown読み取り、固定されたHost diagnosticsなど、対応する制限付き観測へルーティングします。無制限の自律Shellではありません。

Run state、Cancelの挙動、Reconnect、データ共有、制限事項は [Tools AI v1仕様](./docs/tools-ai-v1.md) を参照してください。

Local indexingとProject contextは実験的機能です。機密・vendor pathの除外や読み取り上限を設けていますが、利用可否はHost側のIndex状態に依存します。

### Terminal / Integrations / Automation

Persistent Terminalは認証付き・Project単位で、出力の再生量と再接続動作に制限があります。Host integrationとAutomationは登録済みリソースと制限された操作を前提にしています。

Repository由来のファイルは信頼できない入力として扱います。Manifest、Skill、Ruleを発見しただけで、その中のCommandを自動実行することはありません。

Developer Workflowsでは、Skills、Rules、MCP server、任意ACP Adapter、Extension declaration、検証Command、読み取り専用AI Reviewを明示的に管理します。詳細は [Developer workflows](./docs/developer-workflows.md) を参照してください。

## Host Protocol / Platform support

認証済みの`GET /api/host` endpointは、バージョン付きCapability snapshotを返します。ClientはOS名から対応機能を推測せず、広告されたCapability stateに従う必要があります。

Host Protocol v1は **Capability discoveryの契約** です。既存のすべてのAPIを置き換える共通実行APIではありません。Adapterによって未対応・部分対応の機能があります。現行ドキュメントではLinux対応、制約付きWSL動作、未実装のnative macOS adapterが明記されています。Secret Vaultにも管理API上の制限があり、Provider / Agentへの一般的なSecret injection機構としてはまだ統合されていません。

正確な仕様と制限は [Host Protocol v1](./docs/HOST_PROTOCOL.md) を参照してください。

## セキュリティモデル

DevMoterは、公開multi-tenant hostingではなく、**単一所有者のプライベートHost** を前提に設計されています。

主な原則:

- 既定でlocalhostにbindする
- DevMoter認証と、状態変更リクエストに対するexact-origin checkを行う
- Provider / upstream credentialをserver-sideに保持する
- Codex RPCを明示的なallowlistで制限する
- 登録済みProject IDを通じてFilesystem accessを解決する
- 機密操作でpath containmentとsymlink checkを行う
- Request、Read、Output、長時間workflowに上限を設ける
- Repository由来の内容をuntrustedとして扱う
- 重要な変更に明示的な承認を要求する
- Browserから任意のShell commandを受け取らない

これらはリスクを抑えるための境界であり、インターネットへ公開してよいことを意味しません。リモート利用前に [SECURITY.md](./SECURITY.md) と [THREAT_MODEL.md](./THREAT_MODEL.md) を確認してください。

## インストール

### 必要環境

- Linux host
- Node.js 22以上 / npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

任意の連携としてGitHub CLI (`gh`) とTailscaleを利用できます。起動前に各upstream CLIを、それぞれの正式な認証フローでログインしてください。

### Quick start

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

ブラウザで開きます。

```text
http://127.0.0.1:8787
```

正式なInstaller、Update flow、systemd user serviceについては [Operations](./docs/operations.md) と [Fast Install](./fastinstall.MD) を参照してください。

### スマートフォンからのPrivate access

DevMoterはlocalhost運用を維持し、Tailscale ServeなどのPrivate HTTPS transportを利用してください。

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

同じtailnet上の端末からPrivate HTTPS URLを開きます。Tailscale Funnelや任意のPublic tunnelを、公開サービス向け認可モデルの代わりに使用しないでください。

### iOS Client

Repositoryには、既に起動しているDevMoter serverへHTTPS接続するiOS clientが含まれています。iPhone上でLinux serverやCoding Agentを実行するものではありません。

IPA生成はGitHub Actionsで行いますが、署名・インストール・実機検証は別工程です。詳細は [iPhone / AltStore手順](./docs/ios-altstore.md) と [LinuxからiPhoneへ](./docs/iphone-linux.ja.md) を参照してください。Linux buildやIPA artifactの生成だけで、実機互換性が確認されたことにはなりません。

## 開発・検証

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Coverage report:

```bash
npm run test:coverage
```

CIは自動テストを担当します。Chromebook / CrostiniやiPhoneの挙動は、同等の自動化がない範囲で [Release Smoke](./RELEASE_SMOKE.md) による実機確認が必要です。Unit testの成功だけでは、Upstream protocol互換性や実機動作を保証しません。

## ドキュメント

| Document | 内容 |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | Server / Browser / Agent / Filesystemの境界 |
| [Security](./SECURITY.md) | 運用前提と脆弱性報告 |
| [Threat model](./THREAT_MODEL.md) | Trust boundaryと攻撃者モデル |
| [Fast Install](./fastinstall.MD) | Quick setup |
| [Operations](./docs/operations.md) | Installer、Update、systemd user service、Health check |
| [Host Protocol v1](./docs/HOST_PROTOCOL.md) | Capability discoveryとAdapter制限 |
| [Tools AI v1](./docs/tools-ai-v1.md) | Tools AIの契約、Cancel、データ処理、制限 |
| [Developer workflows](./docs/developer-workflows.md) | Skills、Rules、MCP、ACP、Extension、検証・Review |
| [iOS / AltStore](./docs/ios-altstore.md) | iOS clientのBuild / Install |
| [Linux to iPhone](./docs/iphone-linux.ja.md) | LinuxからiPhoneへの導入手順 |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | Browser automationの境界 |
| [Remote-control security](./docs/remote-control-security.md) | Host registryとAutomationの安全性 |
| [Release smoke](./RELEASE_SMOKE.md) | 手動Release validation |
| [Roadmap](./ROADMAP.md) | 成熟度ゲートと今後の方向性 |

## 開発原則

1. **Host-owned execution.** Coding processとローカルリソースは、それを所有するマシンに置く。
2. **Mobile-first control.** スマートフォンを縮小版Desktopではなく、第一級の操作面として設計する。
3. **Least authority.** AgentとBrowser clientには、必要な範囲の限定されたCapabilityだけを与える。
4. **Human approval for consequential changes.** 重要な変更は可視化し、意図的な承認を求める。
5. **Honest maturity labels.** 未実装・未検証の機能を実装済みとして説明しない。
6. **Interoperability.** 特定ProviderやAgentへの固定ではなく、既存の開発ツールを連携させる。

## Contributing

Issue、互換性報告、ドキュメント改善、Pull Requestを歓迎します。脆弱性は公開Issueにexploit detailを書かず、[SECURITY.md](./SECURITY.md) の手順に従ってください。API key、Token、Password、Private repository dataを報告に含めないでください。

## License

MIT。詳細は [LICENSE](./LICENSE) を参照してください。

---

**DevMoter FAST v3 — 開発環境を、自分の手の中でコントロールする。**
