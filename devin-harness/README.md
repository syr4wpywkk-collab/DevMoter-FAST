# devin-harness — Devin CLI 自律並列開発ハーネス

Devin CLI（`devin`）を並列ワーカーとして統括制御する自律開発ハーネスです。
DevMoter-FAST 本体とは独立したサブプロジェクト（独自の `package.json` を持ち、本体の build / test には影響しません）。

単なるタスク実行ではなく、次を統合しています：

- **動的権限制御** — 仕様モードを Devin CLI の実モードへ写像し、ベース禁止ポリシーとの単調減少ロックで合成した一時 `--config` をワーカー毎に生成
- **モデル / 推論強度ルーティング** — `devin models` カタログをパースし、`effort` を各ファミリのバリアント ID へ自動マッピング（未対応時は安全にフォールバック＋警告）
- **Usage 集計** — 全ワーカーの `--export`（ATIF）からトークン実績を収集し、無料枠（SWE-2）と有料クォータ消費を分離集計、予算ガード付き
- **安全な画像送信** — Linux 静的バイナリ `img-ingest`（Go）に stdin パイプで Base64 を渡し、マジックバイト検証・EXIF 除去・リサイズ・アトミック配置まで実施
- **Gatekeeper ＆ `--resume` 差し戻しループ** — テスト等の検証が NG の場合、同じ `session_id` を `--resume` して文脈を保ったまま修正させる（上限付き）

## アーキテクチャ（仕様の5層との対応）

| 層 | 実装 |
|---|---|
| 1. Control Plane | `src/cli/`（`harness` コマンド：run / perm / model / usage / attach-image / doctor） |
| 2. Policy & Router | `src/policy/`（単調減少マージ＋一時 config 生成）、`src/router/`（カタログ＋effort ルーティング） |
| 3. Isolation & Media | `src/pool/worktree.ts`（git worktree 隔離）、`img-ingest/`（Go 静的バイナリ）、`src/media/`（連携クライアント） |
| 4. Worker Pool | `src/pool/`（`devin -p` 並列実行・タイムアウト kill・`--resume` 差し戻し）、`src/adapters/`（ACP / Cloud API の抽象とスタブ） |
| 5. Telemetry & Gatekeeper | `src/usage/`（ATIF パース・JSONL 集計・予算ガード）、`src/pool/gatekeeper.ts` |

## 前提

- Node.js >= 22
- Devin CLI（確認済みバージョン：3000.14.30821、`~/.local/bin/devin` 等）。`DEVIN_BIN` 環境変数で差し替え可能
- `autonomous` モード（`--sandbox`）を使う場合は Linux の `bwrap`（bubblewrap）と `socat` が必要。`harness doctor` が不足を検出し、導入手順（`sudo apt-get install -y bubblewrap socat`）を表示します
- `img-ingest` のビルドにのみ Go（ビルド済みバイナリの実行には不要）

## セットアップ

```bash
cd devin-harness
npm install
npm run build            # dist/ にコンパイル

# img-ingest（Go 静的バイナリ）を bin/ にビルド
bash scripts/build-img-ingest.sh   # -> bin/img-ingest (amd64), bin/img-ingest-arm64
```

バイナリ自体はリポジトリにコミットしません（ソースは `img-ingest/`）。`bin/` が無い状態で画像機能を使うと、ビルド手順を案内するエラーになります。

## 使い方

```bash
# 事前チェック（devin doctor 連携）
node dist/src/cli/main.js doctor

# 単発タスク
node dist/src/cli/main.js run --id fix-123 --prompt-file task.md --repo /path/to/repo

# 複数タスクを並列に（TaskSpec JSON の配列ファイル）
node dist/src/cli/main.js run --tasks tasks.json --concurrency 3 --max-retries 2

# 権限ポリシーの確認・変更
node dist/src/cli/main.js perm show --profile sandbox-dev
node dist/src/cli/main.js perm set --profile readonly-audit --mode smart --allow "Read(**)"

# モデル
node dist/src/cli/main.js model list
node dist/src/cli/main.js model set --role implement --model swe-2-medium --effort medium

# Usage 集計（モデル別・無料枠比率・推定コスト）
node dist/src/cli/main.js usage
node dist/src/cli/main.js usage --live

# 画像を worktree へ安全に投入
node dist/src/cli/main.js attach-image --worktree <path> --file screenshot.png --label ui-bug
```

タスク実行時の流れ：worktree 作成（ブランチ `harness/<task-id>`）→ 画像投入（あれば）→ ポリシー合成と一時 config 生成 → モデル解決と予算ガード → `devin -p` 実行 → ATIF から Usage 記録 → Gatekeeper 検証 → NG なら `--resume` 差し戻し（最大リトライまで）→ `.harness_attachments` と worktree の後片付け（`--keep-worktree` で保持可）。

## 設定ファイル（`config/`）

| ファイル | 内容 |
|---|---|
| `base-deny.json` | 不変のベース禁止ポリシー（`.env*`、`~/.ssh/**`、`~/.config/devin/**`、`sudo` 等）。どのプロファイル／タスク指定でも緩められません |
| `profiles.json` | 権限プロファイルのプリセット（`readonly-audit` / `sandbox-dev` / `full-trusted`）と既定モード |
| `routing.json` | ロール別（implement / plan / audit / default）のモデルと effort、`DEVIN_REFUSAL_FALLBACK` の注入元 |
| `pricing.json` | モデル別の単価・クォータ重み・無料枠フラグ（コスト推定と無料/有料分離集計に使用） |
| `budget.json` | 日次トークン上限・有料モデル連続起動上限と、超過時の動作（`downgrade` = swe-2-medium へ自動降格 / `stop` = 実行拒否） |

実行状態（Usage の JSONL、カタログキャッシュ、実行中ワーカー登録）は `.harness-state/`（gitignore 済み）に保存されます。

## 仕様からの適応（実仕様に合わせた点）

構築仕様書（マスタープロンプト）の記述と Devin CLI 実物（`--help` / 実測）が異なる点は、実物に合わせて以下に適応しました。

1. **権限モード**：仕様の `normal` / `autonomous` は CLI に存在しません（実在値は `auto` / `accept-edits` / `smart` / `dangerous`）。
   - `normal` → `auto` に写像。
   - `autonomous` → `--sandbox` ＋ `smart` ＋ 一時 config による対象 worktree 限定 `Write(<worktree>/**)` 許可で実現（サンドボックス時の edit/write 確認プロンプトで非対話実行が止まらないようにするため）。
2. **`--config` の意味**：CLI の `--config` は「設定ファイルパスの上書き」です。ハーネスはワーカー毎に一時 config JSON を生成してそのパスを渡します。生成時は既存のユーザー設定（`~/.config/devin/config.json`）があれば読み取り、他の設定キーを保持したまま `permissions` を合成します（deny は和集合、allow は最終 deny でフィルタ）。
3. **`--export` の実構造**：実測（2026-11-20、swe-2-medium の最小実行）で **ATIF-v1.7** 形式であることを確認しました。`final_metrics` に `total_prompt_tokens` / `total_completion_tokens` / `total_cached_tokens` があり、トークン集計に使えます。ただし **cache-write トークンと USD 金額は含まれない**ため、cache-write は `null` とし、コストは `pricing.json` の単価表で推定します。
4. **Usage の永続化**：仕様が許容する選択肢のうち、堅牢性と依存ゼロを優先して **JSONL** を既定にしました（SQLite は不採用）。
5. **WebP の再エンコード**：Go の `golang.org/x/image` には WebP エンコーダが無いため、WebP 入力はデコード後に **PNG へ変換**して配置します（サニタイズ自体は維持。mime / 拡張子も `image/png` / `.png` になります）。
6. **img-ingest バイナリ**：リポジトリにはソースとビルドスクリプトを置き、バイナリは `scripts/build-img-ingest.sh` で生成します（amd64 / arm64 の静的ビルド、CGO_ENABLED=0）。

## スタブ / 未完の部分（正直な現状）

- **ACP アダプター**（`src/adapters/acp-runner.ts`）：`WorkerRunner` インターフェースと将来の JSON-RPC マッピング計画コメントのみで、`run()` は未実装エラーを投げます。既定は print ランナーです。
- **Devin Cloud API フック**（`src/adapters/cloud.ts`）：インターフェースとスタブのみ。`DEVIN_API_TOKEN` の有無だけを見て、ネットワーク呼び出しは行いません（トークン値をログや戻り値に含めることもありません）。
- **Gatekeeper の AI diff レビュー**：`runGatekeeper` は `deps.reviewFn` 経由で利用できますが、Worker Pool からの自動配線（PoolOptions への差し込み口）は未実装です。コマンドベースの検証は動作します。
- **`harness run` の実 Devin セッション実行**：ユニットテストは FakeRunner で全経路を検証済みですが、実セッションでの通し実行は未検証です（構築環境では他の Devin セッションが稼働していたため）。`harness doctor` / `model list` / `attach-image` は実物で動作確認済みです。

## テスト

```bash
npm test                                   # TypeScript：build + node --test（34件）
cd img-ingest && go test ./...             # Go：15件
```

全ての外部コマンドは `spawn(bin, args, { shell: false })` で実行し、トークンや Base64 生データをログに出力しない設計です。
