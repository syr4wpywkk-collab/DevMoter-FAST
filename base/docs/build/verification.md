# エンジンのビルド検証結果

`npm run build:engines:container` で、固定した上流コミットから4エンジンをビルドし、スモークテスト（起動して読み書きを確認）を実行した結果です。各ビルドの詳細（コミット、コンパイラ、バイナリの SHA-256）は `build/<アーキテクチャ>/<エンジン>/BUILD_INFO.json` に出力されます。

## 条件

- 実施日: 2026-11-23（UTC）
- ホスト: Linux x86-64、8コア、Docker 29.9.2
- ビルド環境: `scripts/build/Dockerfile`（`node:22-bookworm-slim` をダイジェストで固定、gcc 12.2.0）。ビルド中はネットワークなし、リポジトリは読み取り専用でマウント
- ARM64: 同じホスト上で `--platform linux/arm64`（QEMU ユーザーモードエミュレーション）。ARM64 の実機では未検証
- GitHub Actions のワークフロー（`.github/workflows/base-engines.yml`）は、アカウントの課金の問題で開始前に失敗するため、GitHub 上では未検証

## 結果

| エンジン | 上流コミット | x86-64 | ARM64（QEMU） |
|---|---|---|---|
| SQLite 3.55.0 | `ebe179657df1` | 成功（90秒） | 成功（761秒） |
| Valkey 255.255.255（開発版） | `28ef86b44342` | 成功（63秒） | 成功（656秒） |
| PostgreSQL 20devel | `19db7e5b36e3` | 成功（55秒） | 成功（897秒） |
| DuckDB v2.1.0-dev0 | `1f21520ea1e4` | 成功（377秒） | 成功（3347秒） |

「成功」は、ビルドとスモークテストの両方が成功したことを表します。時間は8並列でのビルドとスモークテストの合計です。

### ARM64 でのテスト

ARM64 のビルド成果物を使い、同じコンテナ（aarch64、QEMU）で `DEVMOTER_BASE_REQUIRE_ENGINES=1` を付けて全テストを実行し、209件すべて成功しました（スキップなし、4エンジンのアダプターを含む）。

DuckDB は QEMU 上で540個のコンパイル単位に1時間近くかかります。ARM64 の実機（または GitHub Actions の ARM64 ランナー）では x86-64 と同程度の時間で終わる見込みですが、未確認です。

## スモークテストの内容

| エンジン | 確認する内容 |
|---|---|
| SQLite | `sqlite3` でテーブル作成・挿入・集計 |
| DuckDB | `duckdb` でテーブル作成・挿入・集計 |
| Valkey | unix ソケットだけでサーバーを起動し、`SET`/`GET` |
| PostgreSQL | `initdb` → unix ソケットだけでサーバーを起動 → `psql` でテーブル作成・挿入・集計 → 停止 |

どのスモークテストも TCP ポートを開きません。

## 再現手順

```sh
npm run build:engines:container                           # ホストのアーキテクチャ
npm run build:engines:container -- --platform linux/arm64 # ARM64（x86-64 ホストでは QEMU）
cat build/*/*/BUILD_INFO.json
```
