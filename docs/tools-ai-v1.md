# Tools AI v1 — 実装・検証レポート

基準はリモート最新main `a2f3f0ea75c87897aab2e2da303597ce8f79d3bb`。feature branch `feat/tools-ai-v1`でUnit 1〜5を段階commitした。
指定された `/home/yunabalongye4/.local/share/opencode-pocket/repos/syr4wpywkk-collab/DevMoter-FAST` は実装環境には存在せず、同一origin・同一SHAの `/workspace/DevMoter-FAST` で作業した。

## 使用方法

既存の起動方法を使用する。

```sh
npm run build
npm start
```

Toolsを開き、対象Projectと設定済みAPI Chat provider / modelを選ぶ。API Chatの既存設定を初期選択に利用でき、Toolsでの選択は専用のlocalStorageキーへ保存する。Vault providerは既存のProject binding・trusted device・Vault authorizationを通す。

「今の変更を調べて」「認証処理を探して」「プロジェクト構成を教えて」「READMEから起動方法を教えて」「接続できない理由を調べて」を入力できる。モデル設定がない場合は実行不可の理由と、既存のprovider設定・手動Toolsへの入口を表示する。既存20ツールの検索・分類・起動導線は「ツールを直接開く」に保持した。

## 1. 変更ファイル

| ファイル | 責務 |
| --- | --- |
| `server/tools-ai/catalog.mjs` | 5操作のschema、scope、permissions、availability、projection/cancellation policy |
| `server/tools-ai/planner.mjs` | JSON提案、取得済みfact選択、provider応答のbyte制限 |
| `server/tools-ai/dispatcher.mjs` | 検証済み操作から既存helperを直接呼ぶ |
| `server/tools-ai/projection.mjs` | データ投影、件数/byte/snippet上限、秘密情報の除外、証拠fact |
| `server/tools-ai/run-store.mjs` | 専用runの原子的保存、重複、再起動unknown、単調増加の更新時刻 |
| `server/tools-ai/service.mjs` | 計画→実行→説明、認可再検証、Stop、元requestの照合 |
| `server.mjs` | 既存owner/origin/passkey認証の内側でrouteを接続。Markdown readを共有helperへ抽出。実体も.mdの通常ファイルに限定し、FDから上限付き読み取り |
| `server/multi-api.mjs` | 両provider protocolへ外部AbortSignalを伝播。既存timeout・通常API Chatを保持 |
| `server/git-workspace.mjs` | 固定Git処理を15秒でboundし、fsmonitor / textconvの実行を抑止。差分取得失敗を空の成功結果へ変換しない |
| `src/tools-ai.ts` | raw run状態と安全なMarkdown描画、code定義の5結果card・error/notice、復帰・応答競合対策 |
| `src/app-shell.ts`, `src/app-shell.css` | AIの既定表示、手動20導線、スクロール外のStop、focus trap、局所的なresponsive調整 |
| `test/tools-ai-catalog.test.mjs`, `test/tools-ai-planner.test.mjs` | schemaとplannerの拒否条件、両protocolのStop |
| `test/tools-ai-runtime.test.mjs` | 実Git/index、projection、run状態、停止・重複・復帰 |
| `test/tools-ai-server.integration.test.mjs` | 実サーバーの認証、5helper、source/builtAt、秘密除外、path/symlink escape、重複照合 |
| `test/tools-ai-ui.test.mjs` | Project固定、同じrunへの復帰、設定/手動導線、安全な表示、古い応答・応答喪失 |
| `test/tools-navigation.test.mjs`, `test/api-chat-overlays.test.mjs`, `test/opencode-overlays.test.mjs` | 手動sectionを開く実際の導線と、新しいshell依存・focus順序を既存回帰検証へ反映 |
| `README.md`, この文書 | 導入方法、契約、検証、限界 |

## 2. Operation catalog

catalog version: `tools-ai-read-v1`。app registryから分離し、サーバーが所有する。
公開するoperation IDは以下の5つだけ。availabilityは選択済みProjectとサーバーが与えたpermissionから計算し、plannerにはsupportedな操作だけを渡す。

| ID | input | output | scope / permission | cancellation |
| --- | --- | --- | --- | --- |
| `git.inspect` | `{maxFiles?: integer 1..10}`、既定5 | `git` | registered-project / project-read。固定Git helperのみ | non-cancellable |
| `project.search` | `{query: string 1..200, limit?: integer 1..20}`、既定10 | `search` | registered-project / project-read。保存済みindexのみ | non-cancellable |
| `project.map` | `{}` | `map` | registered-project / project-read。保存済みindexのみ | non-cancellable |
| `doc.read` | `{path: string 1..300}`、相対`.md`のみ | `document` | registered-project / project-read。既存realpath境界検証 | non-cancellable |
| `diagnostics.read` | `{}` | `diagnostics` | authenticated-local-host / host-observation。`bounded-exec-read` | non-cancellable |

Projectがなければ診断のみsupportedになる。diagnosticsは既存の固定version/health観測を呼び、任意commandの入力も権限も追加しない。
index未構築はunavailableの実結果を返す。search/mapの`builtAt`を保存・表示し、「現在のファイル状態は未確認」と明記する。rebuildを呼ぶ経路はない。

## 3. Planner JSON schema

概略:

```json
{
  "type": "object",
  "required": ["operationId", "input"],
  "additionalProperties": false,
  "properties": {
    "operationId": { "enum": ["git.inspect", "project.search", "project.map", "doc.read", "diagnostics.read"] },
    "input": { "type": "object" },
    "reason": { "type": "string", "maxLength": 500 }
  }
}
```

`input`はoperation別schemaで再検証し、追加propertyを拒否する。厳密なJSONのみ受け付け、code fenceや壊れたJSONは失敗。応答は16KB以内。不明/利用不可operation、project/backend/session/device等の追加field、任意URL/command/selector、範囲外pathは実行しない。

scopeはmodelが提示したIDから取得せず、開始時にサーバーで解決したProject・host・device・backendに固定する。実行前にProjectの登録/root、device失効、owner session、Vault providerの認可を再確認する。

取得後の説明は、モデルが`{"factIds":["f0", "f1"]}`で取得済みfactを最大8個選び、サーバーがraw Markdownを組み立てる。未知IDや自由文fieldを拒否する。自由な原因推定や未取得情報を説明に追加する機能は含まない。UIは保持したraw textを既存の安全なMarkdown rendererへ渡し、DOMから復元しない。結果・進行表示はi18nの書き換え対象からも除外する。

## 4. Run state model / API

runは`runId`、createdAt/updatedAt、status、rawGoal、選択planner、固定context、catalog version、steps、failure、cancellation、unresolvedQuestion、pendingApprovalReferenceを保持する。
stepには一意なstepOperationId、catalog operationId、validatedInput、実resultとresultReference、status、failure、開始/終了時刻、cancellation capabilityを保持する。

```text
planning → running → completed
    │          │
    ├──────────┴─→ failed
    └→ stop_requested → stopped

host再起動で未完了run / step → unknown（自動再開なし）
```

ownerとdeviceへ結び付け、別owner/deviceは取得・停止できない。既存`operation-registry.mjs`はrun storeとして使わない。
専用fileは`~/.config/opencode-pocket/tools-ai-runs.json`、directory作成時0700 / file 0600、atomic renameで保存。最大50 runを保持し、古いterminal runを順次削除する。入力されたrawGoalは仕様どおりこのprivate fileに保持する。結果は秘密除外済み・boundedなデータを保存する。

| method / path | 動作 |
| --- | --- |
| `GET /api/tools-ai/context` | 登録Project、公開provider metadata、catalog、実行先 |
| `POST /api/tools-ai/runs` | 固定request IDで新しいrunを開始 |
| `GET /api/tools-ai/runs/:runId` | 同じrunの実状態へ再接続 |
| `POST /api/tools-ai/runs/:runId/stop` | 停止要求 |
| `GET /api/tools-ai/requests/:requestId` | 応答喪失時、元requestのrunを照合 |

保持中runと同じrequest IDは409。成功とは扱わず、元runの実状態を再取得する。同じstep operation IDも409で拒否する。保持上限を超えて削除されたrunは照合できず、成功とは扱わない。
UIは未確認request IDを保持し、同じ依頼を再送する場合は同じIDを使う。古いGET/Stop応答が新しいrunや新しい終状態を上書きしないようIDと単調増加updatedAtを照合する。

## 5. Stopの保証範囲

- サーバーが停止要求を受けたら、新しいcatalog operationや次のdispatcher helperを開始しない。
- planner/説明用HTTP要求へAbortSignalを送る。provider内部の計算まで停止したとは保証せず、`providerMayContinue`を保持・表示する。
- 開始済みの既存読み取りhelperにはcancel契約がない。終了を待ち、返った実結果を記録して継続を止める。helper内部の固定処理まで中断する保証はない。
- `stop_requested`と`stopped`を分ける。完了が先ならcompletedを保持する。停止要求が届かなければUIは失敗として示し、停止完了と表示しない。
- UIを閉じてもrunは保持する。host再起動で照合できない未完了処理はunknownとし、再実行しない。

## 6. Secret redaction / size limits

- 全結果のJSON envelopeは24,000 bytes以内。文字列合計budget 12,000 bytes、各array最大40件。
- snippet/stringは最大800 bytes、各diffは4,000 bytes、Markdown本文は8,000 bytes。Git diffの既存256KiB/2400行上限も残る。
- Gitは最大10変更ファイル（既定5）、検索最大20結果（既定10）。repo mapの全file/symbol一覧をそのままモデルへ送らない。
- 検出は切り詰め前の内容全体に行う。既存helperで既知credentialを扱い、credential assignment、provider token、JWT、Authorization、URL埋め込みcredential、private-key等を除外する。
- 疑わしい行を除外し、安全に分離できないmultiline assignment/private-keyはfield全体を除外する。除外file pathも考慮するが、内容の検査も行う。
- providerへ送る説明用データはbounded resultから作ったfactだけ。巨大responseは送信/保存せずunavailableで示す。providerの応答bodyは256,000 bytesで打ち切る。
- 入力欄にprovider/modelとProject内容の共有を表示し、除外時にnoticeを出す。ruleによる検出は未知のsecret形式をすべて識別する保証ではない。

## 7–8. 検証

`npm test`と`npm run test:coverage`はそれぞれ450件中449成功 / 0失敗 / 1 skip（tmux未導入）。Tools AIサーバーモジュールのline coverageは93.47%。`npm run typecheck`、`npm run lint`（228 source files）、`npm run build`も成功。buildには既存の500kB超chunk警告が残る。Chromiumの保存済み検証15項目はすべて成功した。最終結果はPR本文と作業報告にも記載する。

- catalog: unknown/unavailable、追加scope field、invalid input、path escape、permissionの検証。
- planner: JSON、未設定、未知fact、両provider protocolへのAbortSignal伝播。
- dispatcher: 実Git、実保存済みindex、Markdown read、diagnostics。indexなし、zero result、builtAt保持、変更後の古いindex。
- projection: credential-like diff/snippet、切り詰め後方のsecret、multiline assignment、過大diff/map。
- run: completed/failed/stopped/unknown、request/step ID重複、owner境界、durable復帰、Stop後のhelper抑止。
- UI: Project切替、閉じて復帰、provider/model、秘密除外、未知状態、応答喪失、古いGET競合、手動20導線。
- 実HTTPサーバーintegration: owner/origin gates、実5helper、symlink escape、.md aliasからコード全文への迂回拒否、FIFO拒否、provider wire protocolとbounded data。
- Chromium実画面: 5つの日本語依頼→実helper結果→実card/説明、同じrunへ再接続、実Stop、実host再起動unknown、320/390px、44px target、縮小viewport、手動scroll、settings overlay、3チャット表示。
- 既存chat配信、approval、interrupt、raw Markdown ownership、overlay、navigationの回帰テストも実行する。

ブラウザー検証のモデルはfixture providerである。単なるモデルmockだけで完了とはせず、実サーバー・実Git/index/Markdown/diagnosticsに接続した。外部の実モデルの選択品質は、credentialが設定された実環境での評価が必要。ソフトウェアキーボードはviewportを500pxへ縮小したChromium条件で検証し、実iOS Safariのキーボード・safe-areaは未検証。

## 9. 未対応事項

自由文の生成説明、複数operationの自律loop、曖昧な依頼への質問往復、native planner、native executor、任意command、編集/test/review/verify、index rebuild、file PUT、任意URL、browser automation、publish、credential/grant変更は含めない。unresolvedQuestionとpendingApprovalReferenceは将来用のnull fieldのみ。Jevや新規framework/runtime dependencyは追加していない。

## 10. v2への接続点

catalogのoperationごとの型・scope・permissions・cancellation、dispatcherのdependency injection、serviceの認可/状態遷移、runの固定backend・結果参照・pendingApprovalReferenceが接続点となる。
将来のCodex adapterはここへnative session/turn ID、実event、既存approvalとinterruptを結び付ける。v1はCodexBridgeのturn/start、approval、interruptを呼ばず、既存chatとは独立した読み取りrunとして動く。v2で別subagentと選択chatを二重起動しない契約を別途検証する。
