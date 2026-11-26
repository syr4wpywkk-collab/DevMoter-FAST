# Remote Browser Step 0 セキュリティ検証（子C）

対象: `acceb51`（main HEAD）と `remote-browser-plan.md`。この文書は PR1（CDP 基盤）に入る前の、セキュリティ前提の調査結果と必須要件をまとめたものです。コードは変更していません。

## 1. 現状コードの所見

| # | 重大度 | 所見 | 場所 | PR1 での要件 |
|---|---|---|---|---|
| F1 | P0 | ブラウザの bwrap 起動が `allowNetwork: true` のため `--unshare-net` が付かず、外部通信が既定で許可される | `server/browser-tool.mjs` `prepare()` | 外部通信を既定拒否にする（§3.3） |
| F2 | P0 | `--remote-debugging-port=0` はホストの名前空間の `127.0.0.1:<random>` で待ち受ける。同じホストの任意のローカルプロセスから `/json/version` 経由で CDP を操作できる（Host ヘッダ検査は DNS rebinding 対策にしかならない） | `server/browser-tool.mjs` `browserArgs()` | `--remote-debugging-pipe` を使い、TCP の CDP を開かない |
| F3 | P0 | `file:///etc/passwd` に遷移でき、内容を読める（bwrap が `/etc` を ro-bind するため） | ナビゲーション検証なし | `file:`、`chrome:`、`devtools:`、`view-source:`、`data:`、`javascript:`、`blob:`（トップレベル）を拒否する。CDP の Fetch で全リクエストを遮断する（§3.4） |
| F4 | P1 | `DEVMOTER_SANDBOX` の既定値 `preferred` では、bwrap がないと隔離なしで起動する。`failClosed` も渡していない。bwrap は VM 標準イメージにも入っていなかった | `server/browser-tool.mjs`、`server/advanced-features.mjs` | Remote Browser は bwrap 必須（`failClosed: true`）とする。`--no-sandbox` は絶対に付けない |
| F5 | P1 | `loopbackHost()` はホストの種類しか見ないため、登録済みプレビュー以外のループバックポートにも到達できる（実測: 18080 を登録していても 18081 を開けた） | `server/browser-tool.mjs` | 遷移先は、サーバー側で解決したプレビューの origin（scheme+host+port）と完全一致させる |
| F6 | P1 | `/api/advanced/browser*` は Basic 認証/オーナーセッション＋同一オリジンの変更チェック＋`claimOperation` だけで保護されている。terminal と違い、信頼済みデバイスの検証がない | `server/advanced-api.mjs`、`server.mjs` | `/api/browser/*` は信頼済みデバイスを必須とし、セッションを `ownerDeviceId` に紐づける |
| F7 | P1 | ポリシー監査は `decide(input)` の `input` を JSON のまま `workspace-policy-audit.jsonl` に書く。`type` 操作の文字列や URL のクエリが残る | `server/workspace-control.mjs` | 監査には操作種別、文字数、origin だけを記録する（値、パスワード、クエリは記録しない） |
| F8 | P2 | ポリシーエンジンは一致するルールがないと `ask` になる。`browser.read` と `browser.act` を区別する規則がない | `server/workspace-control.mjs` | `evaluate` は常に deny とし、read と act を別々に判定する |

## 2. 再利用できる既存の仕組み

- WS: terminal の方式をそのまま使う。チケットは 32 バイトの hex で TTL 20 秒、一度だけ使え、検証前に削除する。sessionId、Origin、deviceId に紐づけ、発行待ちの上限を設け、失効したデバイスのチケットを消す。Origin は完全一致で照合し、サブプロトコルでチケットを渡し、`maxPayload` を設ける（`server/terminal.mjs`、`server/terminal-websocket.mjs`）。ブラウザ用には、チケットに操作権の世代番号を加える。計画書の TTL は 30 秒だが、terminal に合わせて 20 秒を推奨する。
- Codex RPC: `CODEX_RPC_AUTHORITY_KEYS`（`cwd`、`sandbox`、`config` など）をクライアントから受け付けない（`server/security-helpers.mjs`）。そのため Browser MCP の注入はホスト側（`agent-run-service`）でしか行えない。
- MCP レジストリ: transport（stdio/http）、scope、危険な env キーを検証している（`server/dev-workflows.mjs`）。

## 3. 実 Chromium での検証（x86_64、Chrome for Testing 156、bwrap 0.6.1）

### 3.1 名前空間サンドボックス
- bwrap の中でも Chromium 自身の名前空間サンドボックスは動く（`--no-sandbox` は不要）。renderer は別の userns/pidns/netns で動き、`Seccomp: 2` だった。
- 前提: `kernel.unprivileged_userns_clone=1`、AppArmor の userns 制限なし。Ubuntu 23.10 以降で AppArmor 制限があると起動に失敗する。その場合は fail-closed にし、`--no-sandbox` で回避しない。

### 3.2 CDP
- `--remote-debugging-pipe`（fd 3/4）で `Browser.getVersion`、`Target.createTarget`/`attachToTarget`、`Page.navigate` が bwrap 内で動くことを確認した。待ち受けソケットは作られない。

### 3.3 外部通信の既定拒否
次のフラグの組み合わせで、プレビュー以外への通信をすべて遮断できた。

```
--proxy-server=http://127.0.0.1:9
--proxy-bypass-list=<-loopback>;127.0.0.1:<previewPort>
--force-webrtc-ip-handling-policy=disable_non_proxied_udp
```

| 遷移先 | 結果 |
|---|---|
| `https://example.com/` | `ERR_PROXY_CONNECTION_FAILED` |
| IP リテラル | 遮断 |
| `http://127.0.0.1:<他ポート>/` | 遮断（`<-loopback>` がないと**許可されてしまう**） |
| `http://localhost:<他ポート>/` | 遮断 |
| `http://127.0.0.1:<previewPort>/` | 許可 |

- 既存の `--no-proxy-server` は削除する。
- 多層防御として bwrap の `--unshare-net` も検討する。ただし、ホストのループバック上のプレビューに届かなくなるため、プレビューを中継するソケットが必要になる。PR1 ではプロキシ方式と CDP Fetch で遮断し、`--unshare-net` は未対応として残存リスクに書くことを推奨する。

### 3.4 CDP Fetch による遮断
- `Fetch.enable({patterns:[{urlPattern:"*"}]})` と許可 origin の照合で、`file://` と他ポートが `ERR_BLOCKED_BY_CLIENT` になった。
- `data:` は Fetch を通らないため、遷移前の検証と `Page.frameRequestedNavigation` で拒否する必要がある。
- `javascript:` は検証中にハーネスが止まったため、**未検証**。

## 4. Debian ARM64
- Debian bookworm arm64 の chroot（qemu-user、Chromium 150）では、`No usable sandbox` で起動できなかった。qemu-user は userns を作れないため、`--no-sandbox` を付けても abort した。**実機 ARM64 は未検証**。
- Debian 実機の要件: `kernel.unprivileged_userns_clone=1`（Debian 11 以降は既定）、または `chromium-sandbox` パッケージ（setuid）。どちらもない場合は起動を拒否する。
- Debian の Chromium は `/usr/lib/chromium/chromium` にあり、`/etc/chromium.d` を読む。bwrap では `/etc` を ro-bind するため、ホスト側のフラグ追加や管理ポリシーが混入しうる。検出したパスと、`--version` で確かめたバージョンを記録する。

## 5. MCP / エージェントトークンの要件（PR4 向け）
- エージェントトークンの仕組みは現状ない。新設する場合は次のとおりとする。
  - 32 バイトの乱数とし、保存時は sha256 だけを持つ。
  - scope は `{runId, projectId, sessionId, caps: ["browser.read"|"browser.act"]}`。
  - `exp` は Run の期限以下にし、Run が終了状態になったら即時失効する。
- MCP サーバー（stdio）には env でトークンを渡す。argv やディスク上の設定ファイルには書かない。CDP の endpoint やポートは渡さない。
- MCP の呼び出しは HTTP API と同じ認可経路を通し、操作権の世代番号を検証する。

## 6. 子A の PR1 レビュー観点
F1〜F7 が解消されていること、§3.3 と §3.4 のフラグと遮断、WS チケットの紐づけと世代番号、操作権を奪還した後の旧操作の拒否、監査ログのマスキング、プロファイルの `0700` と破棄。
