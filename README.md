# DevMoter Base

PostgreSQL・SQLite・DuckDB・Valkey の4エンジンを統合する、セルフホスト可能なデータ管理プラットフォームです。DevMoter FAST や AI エージェントから、データの保存・検索・分析・管理を安全に行えるようにすることを目標にしています。

現在は開発初期段階です。ローカル検証環境専用で、本番利用や外部公開はできません。実装と検証の状況は [機能トラッカー](docs/roadmap/features.md) にあります。

## 構成

| パス | 内容 |
|---|---|
| `engines/` | 4エンジンの上流ソース（取り込みのみ。編集しない）。出典は [`engines/UPSTREAM.md`](engines/UPSTREAM.md) |
| `src/` | DevMoter Base 独自の統合層（TypeScript） |
| `scripts/` | 開発・検査用スクリプト |
| `test/` | 自動テスト |
| `docs/` | 設計・監査・進捗の文書 |

## 必要環境

- Node.js 22.18 以上（TypeScript をビルドなしで直接実行します）
- Linux x86-64 または ARM64

## 開発コマンド

```sh
npm ci              # 依存パッケージの導入
npm run typecheck   # 型検査
npm test            # 自動テスト
npm run deps:check  # 依存関係検査（バージョン固定・取得元・ライセンス・既知の脆弱性）
npm run upstream:verify  # engines/ が固定した上流コミットと一致するか（--online で上流にも照会）
npm run stats:update     # コード行数・言語別統計を再生成（docs/stats/）
npm run stats:check      # 統計が最新かどうか
npm run check       # 型検査・テスト・依存関係検査・上流照合・統計確認をまとめて実行
```

CI（GitHub Actions）は Pull Request と main への push ごとに、x86-64 と ARM64 の両方で同じ検査を実行します。

## 構造化ログ

`src/logging/` のロガーは1行1 JSON で出力し、パスワード・トークン・API キー・接続 URL 内の認証情報を自動で伏せます。出力レベルは環境変数 `DEVMOTER_BASE_LOG_LEVEL`（`trace` `debug` `info` `warn` `error` `fatal` `silent`、既定は `info`）で変更します。

```json
{"time":"2026-11-24T00:00:00.000Z","level":"info","msg":"server started","service":"devmoter-base","port":8765}
```

## 上流ソースの固定

4エンジンの上流コミットは [`engines/manifest.json`](engines/manifest.json) に固定しています。`npm run upstream:verify` は各ディレクトリの git ツリー ID が固定値と一致することを確認するので、`engines/` 内を1バイトでも変更すると失敗します。経緯と更新手順は [`engines/UPSTREAM.md`](engines/UPSTREAM.md) にあります。

## コード行数・言語別統計

[`docs/stats/code-stats.md`](docs/stats/code-stats.md) に、独自コード・テスト・ドキュメント・設定・取り込んだエンジンを分けた行数と言語別の内訳があります。ファイルを追加・変更したら `npm run stats:update` で再生成してコミットしてください（`npm run check` が古い統計を検出します）。エンジンの行数は固定したツリー ID ごとに記録するので、固定先を変えない限り数え直しません。

## 依存関係検査

`npm run deps:check` は次を検査し、違反があれば失敗します。

- `package.json` の依存がすべて厳密なバージョン指定である
- `package-lock.json` が `package.json` と一致し、全パッケージが npm 公式レジストリ由来で sha512 の整合性ハッシュを持つ
- ライセンスが許可リスト内である
- インストールスクリプトを持つパッケージが許可リスト内である
- high 以上の既知の脆弱性がない（`npm audit`。`--offline` で省略可）

依存パッケージのインストールスクリプトは `.npmrc` の `ignore-scripts=true` で実行されません。CI は `npm ci` の前に `node scripts/deps/check.ts --offline` で lockfile を検査します。スクリプトが必要なパッケージを入れる場合は、許可リストに追加したうえで `npm rebuild <パッケージ名> --ignore-scripts=false` を明示的に実行します。

npm パッケージと GitHub Actions の更新は Dependabot が週次で PR にします。
