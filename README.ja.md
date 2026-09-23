# DevMoter FAST

**コーディングエージェントを、ポケットサイズのコントロールプレーンへ。📱**

[English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

DevMoter FAST は、Codex / OpenCode / API Chat とローカルの開発環境をまとめて操作するための **オープンソース・セルフホスト・mobile-first コントロールプレーン**です。

エージェント、リポジトリ、認証情報、ツールは Linux ホスト側に置いたまま、スマホ・タブレット・ブラウザを操作面として使います。単なるチャットUIではなく、セッション、Projects、Git/GitHub、Reviewed Changes、ホスト連携、automation、安全境界までを一つのUIにまとめることを目指しています。

> [!IMPORTANT]
> **Alpha / active development.** 非公式コミュニティプロジェクトであり、OpenAI、OpenCode、GitHub、Anthropic、Google、Tailscale その他の提供元とは提携・承認関係にありません。

> [!WARNING]
> 現在は **単一ユーザーのプライベートホスト / プライベートネットワーク** 向けです。localhost を基本とし、外部から使う場合は Tailscale Serve などのプライベート HTTPS を利用してください。公開インターネットへ直接露出する用途は想定していません。

## 30秒で分かる構成

```text
スマホ / タブレット / PWA
          │
          ▼
     DevMoter FAST
   mobile control plane
     │      │      │
     ▼      ▼      ▼
  Codex  OpenCode  API Chat
     └──────┼──────┘
            ▼
      Projects · Git
            ▼
        Linux host
```

開発マシンを動かしたまま席を離れ、スマホから進捗確認・承認・割り込み・モデル/エージェント切替・作業継続を行う、というワークフローが中心です。

## 機能ステータス

「画面にある」ことと「完成している」ことを区別します。

| 機能 | 状態 | 現在の範囲 |
| --- | --- | --- |
| OpenCode | ✅ Shipped | sessions、agents、models/providers、modes、commands、skills、streaming、permissions/questions、interrupt |
| Codex | ✅ Shipped | threads、resume/fork、動的モデル取得、推論量、streaming、approvals、attachments、plugins/MCP |
| Projects | ✅ Shipped | project登録/切替、安全境界付きMarkdown閲覧・編集 |
| GitHub workspace | ✅ Shipped | host `gh` を使ったrepo取得、managed clone/open、安全なbranch/fetch |
| API Chat | 🧪 Experimental | 複数provider/model、推論モード、画像添付 |
| Reviewed Changes / Tasks | 🧪 Experimental | proposal、hunk review、drift検証、apply/commit、worktree/PR |
| Automation / Control plane | 🧪 Experimental | host registry、schedule/trigger、bounded automation |
| Antigravity / Claude連携 | 🧪 Experimental | ローカル検出と一部launch/remote handoff |
| PWA / mobile UI | ✅ Shipped | responsive UI、backend切替、reconnect、installable shell |
| Passkey / device controls | 🧪 Experimental | 補助的な端末制御。公開SaaS向け認可ではありません |
| Library | 🗺️ Planned | 未実装 |
| Google / Microsoft / Appleログイン | 🗺️ Planned | 未実装 |

Codexのモデル一覧など、上流が提供する情報に依存する機能は動的です。DevMoter側で存在しないモデルを捏造しません。

## 最短起動

必要環境: Linux、Node.js 22 + npm、Git、Python 3、curl、OpenCode CLI、OpenAI Codex CLI。

```bash
git clone https://github.com/syr4wpywkk-collab/DevMoter-FAST.git
cd DevMoter-FAST
npm ci
bash scripts/start-pocket.sh
```

ローカルでは `http://127.0.0.1:8787` を開きます。

詳しくは [Fast Install](./fastinstall.MD) と [Operations](./docs/operations.md) を参照してください。

## スマホから使う

DevMoterはlocalhost運用を基本にしています。Tailscaleを使う場合:

```bash
tailscale serve reset
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

同じtailnetのスマホから表示されたHTTPS URLを開きます。現在のAlphaではFunnelや任意の公開トンネルを推奨しません。

## 主要サーフェス

**Codex** — ローカルCodex app-serverとstdio/JSONLで通信します。threads、streaming、approvals、interrupt、attachments、動的model discovery、modelが公開するreasoning effort、plugins/MCPを扱います。RPCはサーバー側allowlistを通ります。

**OpenCode** — localhost上のOpenCodeをDevMoter経由で操作します。sessions、agents、Plan/Ask/Build、provider/model、commands/skills、reasoning/tool activity、permissions/questions、interruptを扱います。OpenCodeの認証情報はブラウザへ返しません。

**API Chat** — Experimentalな複数provider向けUIです。保存したAPI keyは設定後にfrontendへ返さない設計です。

## Projects / Git / Reviewed Changes

ブラウザから任意cwdを直接指定するのではなく、登録済みProject IDをサーバー側で解決します。Projectはhome directory配下に制約され、traversalやsymlink escapeを防ぎ、モバイルエディタの書き込みはサイズ制限付きMarkdownへ絞っています。

GitHub連携はhostの`gh`セッションを利用し、clone先をmanaged rootに限定します。Reviewed Changesはproposal→hunk review→drift検証→apply/commit→worktree/PRという流れをExperimental機能として提供します。

## セキュリティモデル

DevMoterは **認証した利用者＝ホスト所有者** を前提とする単一ユーザー設計です。

主な境界:
- localhost bindが既定
- DevMoter独自認証
- mutationのexact-origin検証
- secret/API responseの`no-store`
- OpenCode credentialはserver-side
- Codexはstdio + RPC allowlist
- registered-project filesystem boundary
- attachmentはhost-local
- GitHub credentialはhostの`gh`に保持

遠隔利用前に [SECURITY.md](./SECURITY.md) と [THREAT_MODEL.md](./THREAT_MODEL.md) を読んでください。

## ドキュメント

- [Architecture](./ARCHITECTURE.md)
- [Security](./SECURITY.md)
- [Threat model](./THREAT_MODEL.md)
- [Fast Install](./fastinstall.MD)
- [Operations](./docs/operations.md)
- [Developer workflows](./docs/developer-workflows.md)
- [Remote-control security](./docs/remote-control-security.md)
- [Release smoke](./RELEASE_SMOKE.md)
- [Roadmap](./ROADMAP.md)

## 開発

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

CIだけでは実機互換性を保証しないため、release前にはChromebook/Crostini + iPhoneの [Release Smoke](./RELEASE_SMOKE.md) も使用します。

## 方針

1. **Host-local by default**
2. **Mobile first**
3. **Agent actionsには安全境界を置く**
4. **ハリボテを完成機能として扱わない**
5. **既存ツールとのinteroperabilityを優先する**

## AI-assisted development

実装、デバッグ、protocol調査、test、iterationにAIを積極的に利用しています。製品方向、要件、実機検証、release判断、maintenanceは人間主導です。

## Contributing / Security

Issue、互換性報告、ドキュメント改善、Pull Requestを歓迎します。脆弱性は攻撃詳細を公開Issueへ書かず [SECURITY.md](./SECURITY.md) の手順を利用してください。秘密情報・token・API key・private repository内容をIssueへ投稿しないでください。

## License

MIT License。詳しくは [LICENSE](./LICENSE)。

---

**DevMoter FAST — 開発マシンは動かしたまま、コントロールプレーンだけ持ち歩く。**
