# DevMoter FAST v2

**コーディングエージェントを、ポケットサイズのコントロールプレーンへ。📱**

[![CI](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml/badge.svg)](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ci.yml)

[English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

> **Version track:** v2.0.0-alpha 系列  
> **Status:** active development / pre-release

DevMoter FAST は、コーディングエージェントと開発ツールをまとめて操作するための **オープンソース・セルフホスト・mobile-first コントロールプレーン**です。

Codex、OpenCode、リポジトリ、認証情報、ターミナル、Gitワークフロー、ホスト連携はLinuxマシン側に残したまま、スマホ・タブレット・PWA・ブラウザを操作面として使います。

DevMoter v2 は、もう単なる「遠隔チャットUI」ではありません。**エージェントセッション、Projects、Git/GitHub、Reviewed Changes、モデルルーティング、Automation、ローカルツール、安全境界**を一つのmobile-first UIへまとめる、host-localなコントロールプレーンへ進化しています。

> [!IMPORTANT]
> DevMoter FAST は非公式コミュニティプロジェクトです。OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscale その他の提供元とは提携・スポンサー・承認関係にありません。

> [!WARNING]
> 現在のDevMoterは **単一ユーザーのプライベートホスト / プライベートネットワーク** 向けです。localhostを基本とし、外部から使う場合はTailscale ServeなどのプライベートHTTPSを利用してください。DevMoterやエージェントbackendを公開インターネットへ直接露出しないでください。

## なぜ v2 なのか

初期世代では、「LinuxホストでCoding Agentを動かし、その作業をスマホから操作する」という中核アイデアを成立させました。

v2では、その考え方をさらに広げて **コントロールプレーン化** しています。

- 1つのチャット面ではなく、複数のAgent backendを扱う
- ブラウザから任意cwdを渡すのではなく、Project単位でセッションを管理する
- patchのコピペではなく、Git/GitHubワークフローまで扱う
- Reviewed Changes、worktree、PR-oriented task flowを持つ
- model/provider routingとAPI Chatを扱う
- persistent terminalとproject context toolを持つ
- host integrationとbounded automationを持つ
- Origin、filesystem、RPC、credential、approvalの境界を強化する
- desktop UIを縮小した画面ではなく、最初からmobile-firstで設計する

目標はシンプルです。

**開発マシンは動かしたまま、コントロールプレーンだけ持ち歩く。**

## 30秒で分かる構成

```text
スマホ / タブレット / ブラウザ / PWA
                 │
                 │ private HTTPS
                 ▼
        ┌───────────────────┐
        │   DevMoter FAST   │
        │ mobile control    │
        │      plane        │
        └─────────┬─────────┘
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
      Codex    OpenCode   API Chat
        │         │         │
        └─────────┼─────────┘
                  ▼
       Projects · Git · Reviews
        Terminal · Tools · Tasks
                  │
                  ▼
              Linux host
```

ブラウザは「開発マシン」ではなく「コントローラー」です。ローカルパス、Agentプロセス、provider credential、repository state、host toolはホスト側に残ります。

## 基本ワークフロー

典型的な使い方はこうです。

**ホストで作業開始 → 席を離れる → 進捗確認 → 承認/割り込み → Agent・Model・Project切替 → 変更レビュー → スマホから継続**

特に次のような環境を想定しています。

- Linux workstation
- Chromebook + Crostini
- home server
- 常時起動の開発マシン
- ローカル開発環境を維持しながら、操作面だけ持ち歩きたいユーザー

## 機能ステータス

DevMoterでは **Shipped / Experimental / Planned** を明確に分けます。画面に入口があることや、repositoryに設計書があることは、その機能がproduction readyであることを意味しません。

| 機能 | 状態 | 現在の範囲 |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions、agents、models/providers、modes、commands、skills、streaming、permissions/questions、interrupt |
| Codex | ✅ Shipped | threads、resume/fork、動的model discovery、reasoning effort、streaming、approvals、attachments、plugins/MCP inventory |
| Projects | ✅ Shipped | registered working directory、project切替、境界付きMarkdown閲覧/編集 |
| GitHub workspace | ✅ Shipped | host-`gh` repo discovery、managed clone/open、branch/fetch safety check |
| Session control | 🧪 Experimental | handoff、follow-up、checkpoint、rewind/fork、transcript search、background-run control |
| Reviewed Changes / Tasks | 🧪 Experimental | proposal review、hunk decision、drift check、apply/commit、worktree、PR flow |
| Project context / local index | 🧪 Experimental | bounded project search、structure/symbol context、local indexing |
| Persistent terminal | 🧪 Experimental | authenticated project-scoped terminal、bounded replay、reconnect |
| API Chat / model routing | 🧪 Experimental | configurable provider/model、reasoning mode、routing/failover、image attachment |
| Automation / control plane | 🧪 Experimental | host registry、schedule/trigger、bounded automation primitive |
| Antigravity / Claude連携 | 🧪 Experimental | local integration discovery、一部launch/remote handoff flow |
| PWA / mobile UI | ✅ Shipped | responsive UI、backend switching、reconnect、installable shell |
| Passkey / device controls | 🧪 Experimental | 補助的な端末制御。公開multi-user認可ではありません |
| Library | 🗺️ Planned | storage/library surfaceは未実装 |
| Google / Microsoft / Appleログイン | 🗺️ Planned | roadmapのみ。未実装 |

> [!NOTE]
> 上流が提供する能力は動的です。たとえばCodexのmodel pickerは、インストール済みCodex app-serverが公開するmodelを利用し、存在しないmodel availabilityをDevMoter側で捏造しません。

## Agent surfaces

### Codex

DevMoterはローカルCodex app-serverとstdio/JSONLで通信します。

現在の主な連携:

- thread作成、history、resume、fork
- streamed turnとinterrupt
- approval
- attachment
- dynamic model discovery
- model-advertised reasoning effort
- plugin/MCP inventory
- upstream app-serverが提供する範囲でusage/rate-limit metadata

Codex RPCは明示的なserver-side allowlistを通ります。認証自体はローカルCodex CLIが保持します。

### OpenCode

DevMoterはlocalhost上のOpenCode runtimeをproxyし、backend credentialをブラウザへ返しません。

mobile surfaceでは次を扱います。

- sessions / agents
- Plan / Ask / Build
- provider / model selection
- commands / skills
- live text / reasoning / tool activity
- permission request / question
- interrupt

### API Chat

Experimentalなmulti-provider向けUIです。model、reasoning control、routing、attachmentを一つのcompactなsurfaceで扱います。

保存されたprovider credentialはserver-sideに保持され、設定後にfrontendへ返しません。

## Projects / Git / Reviewed Changes

DevMoterはブラウザから任意の`cwd`を受け取るのではなく、登録済み **Project ID** を使います。

主な境界:

- registered projectはuser home directory配下に制約
- traversal / project-root escapeを拒否
- sensitiveなfile operationではsymlink boundaryを確認
- local project readはbounded
- mobile editor writeは意図的に制限
- GitHub cloneはmanaged repository rootへ限定
- dirty worktreeは危険な再利用や破壊操作を必要に応じてblock

ExperimentalなReviewed Changes workflowでは次の流れを扱います。

1. proposed changes
2. file / hunk単位のreview
3. context drift validation
4. explicit apply
5. commit validation
6. managed task worktree
7. PR-oriented task flow

重要なmutationを見えない自動化にするのではなく、**inspectableかつboundedな操作**にすることを重視しています。

## Local context / Terminal

v2ではchat以外のhost-local developer surfaceも増えています。

Experimentalな機能:

- project structure / symbol context
- bounded local full-text index
- sensitive/vendor path exclusion
- reconnect可能なproject-scoped terminal
- bounded terminal output replay
- mobile-friendly terminal control

これらはunrestrictedなbrowser-side shellではなく、registered project boundaryを前提に設計されています。

## Automation / Integrations

v2 architectureには、host integrationとautomationを扱うExperimentalなcontrol-plane layerがあります。

例:

- host registry
- bounded schedule / trigger
- explicit integration discovery
- selected launch / remote handoff
- supported agent/model surface間のrouting

Automationはauthorization boundaryを飛び越えるための仕組みではありません。高い影響を持つ操作ほど、explicit・scoped・auditableであることを重視します。

## セキュリティモデル

DevMoterは現在、**認証済みユーザー = ホスト所有者** を前提としています。公開multi-tenant SaaS向けのauthorization systemではありません。

主な境界:

- localhost bindが既定
- DevMoter独自認証
- state-changing requestのexact-origin check
- secret-bearing/API responseの`no-store`
- provider credentialはserver-side
- OpenCode credentialをbrowserへ返さない
- Codexはstdio + RPC allowlist
- registered-project filesystem boundary
- sensitive pathのrealpath/symlink containment check
- attachmentはhost-local
- GitHub credentialはhostの`gh` sessionに保持
- browserから任意shell commandを受け取らず、host integrationはfixed-argument launcherを使用
- bounded approval / task workflow

remote deployment前に **[SECURITY.md](./SECURITY.md)** と **[THREAT_MODEL.md](./THREAT_MODEL.md)** を読んでください。

### Alphaであることについて

v2.0.0-alpha系はまだdevelopment softwareです。

Security / integration auditは継続中で、Experimental surfaceは変更される可能性があります。またCodex/OpenCode/CLIなど上流の挙動もDevMoterとは独立して変化します。

`main`はhardened public serviceではなく、development branchとして扱ってください。

## 最短起動

### 必要環境

- Linux
- Node.js 22 + npm
- Git
- Python 3
- `curl`
- OpenCode CLI
- OpenAI Codex CLI

任意:

- repository integration用のGitHub CLI (`gh`)
- private phone access用のTailscale

DevMoter起動前に、各upstream CLIはそれぞれの公式な認証フローでログインしてください。

### Install

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

その後、次を開きます。

```text
http://127.0.0.1:8787
```

通常launcherはbuild、local auth準備、必要なlocal runtime起動、DevMoter起動、readiness checkまで行います。

最短セットアップは **[Fast Install](./fastinstall.MD)**、systemdやupdate operationは **[Operations](./docs/operations.md)** を参照してください。

## スマホからのprivate access

DevMoterはlocalhost運用を基本にしています。

Tailscaleを利用する場合:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

同じtailnetの端末から、表示されたprivate HTTPS URLを開きます。

> [!CAUTION]
> 現在のAlphaではTailscale Funnelや任意のpublic tunnelを推奨しません。DevMoterのloginはsingle-user access boundaryであり、public SaaS向け認可ではありません。

## ドキュメント

| Document | 内容 |
| --- | --- |
| [Architecture](./ARCHITECTURE.md) | process / browser / agent / filesystem boundary |
| [Security](./SECURITY.md) | deployment assumption / vulnerability reporting |
| [Threat model](./THREAT_MODEL.md) | trust boundary / attacker model |
| [Fast Install](./fastinstall.MD) | 最短セットアップ |
| [Operations](./docs/operations.md) | systemd / update / operation |
| [Developer workflows](./docs/developer-workflows.md) | extensions / MCP / ACP / skills / rules |
| [Browser automation sandbox](./docs/BROWSER_AUTOMATION_SANDBOX.md) | browser automation boundary |
| [Remote-control security](./docs/remote-control-security.md) | host registry / automation security |
| [Release smoke](./RELEASE_SMOKE.md) | 実機release checklist |
| [Roadmap](./ROADMAP.md) | 今後の方向性 / maturity gate |

## 開発

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Coverage:

```bash
npm run test:coverage
```

CIは自動checkを担当します。Chromebook/Crostini + iPhoneの実機挙動は、引き続きmanualの [Release Smoke](./RELEASE_SMOKE.md) で確認します。

## Compatibility

DevMoterが接続するupstream toolのprotocolは変化する可能性があります。

互換性対応の対象例:

- event envelope
- streaming
- approval
- image / attachment
- model change
- plugin / MCP inventory
- provider metadata
- version-sensitive RPC behavior

互換性Issueを報告する場合は次を含めてください。

- DevMoter commit
- relevant Codex/OpenCode version
- browser/PWA environment
- exact error text
- 問題が発生した操作

API key、token、generated password、private repository内容などのsecretは含めないでください。

## Project principles

1. **Host-local by default.** Credentialとcoding processは自分のmachineに残す。
2. **Mobile is a first-class control surface.** Desktop pageをスマホ幅へ押し込んだだけのUIにしない。
3. **Agent actions need boundaries.** Filesystem、Git、RPC、automation、approval、host integrationはfail closedを基本にする。
4. **Important mutations should be inspectable.** 見えない自動化より、reviewとexplicit consentを優先する。
5. **No fake capability.** Plannedやupstream-dependentな機能は正直にラベル付けする。
6. **Interoperability over lock-in.** 既存のdeveloper toolを無理に置き換えず、つなぐことを優先する。

## AI-assisted development

DevMoter FASTは実装、debug、protocol research、test、review、iterationでAIを積極的に利用しています。

一方、製品方向、要件、実機validation、release判断、maintenanceは人間主導です。

## Contributing

Issue、compatibility finding、documentation improvement、security report、Pull Requestを歓迎します。

脆弱性は公開Issueへexploit detailを書くのではなく、**[SECURITY.md](./SECURITY.md)** の手順に従ってください。

## License

MIT。詳しくは [LICENSE](./LICENSE)。

---

**DevMoter FAST v2 — 開発マシンは動かしたまま、コントロールプレーンだけ持ち歩く。**
