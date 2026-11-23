# SPEC-OPEN — 未確定の Excel 仕様 / undecided compatibility points

実装中に推測で固定しなかった仕様点をここに記録する。互換性フィクスチャ
（Excel デスクトップ / Excel Web / LibreOffice での実測）で確認後に確定する。
`specOpen: true` cases in `tests/fixtures/golden-phase1.json` mirror the
Phase 1 table below.

## PR 01 (core types / references)

1. **`#CIRC!` の表示方針** — 循環参照を内部で型付きエラーとして保持する
   `CalcError::Circ` を用意したが、Excel は循環参照を独立した UI 通知で
   扱いエラーリテラルは持たない。ユーザーへの表示形式（`#CIRC!` でよいか、
   別チャネルか）は未確定。
2. **General 書式との完全な一致** — `Value::to_text` / `format_number` は
   整数は小数点なし、非整数は最短往復表現で出力する。Excel の General
   書式は列幅・有効桁数 15 桁で科学的記法に切り替わるなど差分がある。
   切替閾値・末尾ゼロ規則をフィクスチャで固定する。
3. **引用なしシート名に使える文字集合** — 現在は「先頭が英字/`_`、以降は
   英数字・`_`・`.`、かつセル参照に見えない」という保守的規則。
   Excel は非 ASCII 文字等をもっと広く許可する可能性がある。
4. **範囲の第二端点のシート修飾** — `Sheet1!A1:Sheet1!B2` は
   Excel では（名前が一致する場合）受理されるが、現状は
   `UnsupportedRangeForm` エラー。対応要否を確認する。
5. **全列・全行参照（`A:A`、`1:1`）** — 未対応として明示エラーにしている。
   計画 §3.2 にも明記がなく、対応時期は後続 PR で決める。
6. **配列上限超過時のエラー種別** — `ArrayValue` の上限違反は一律
   `#VALUE!` を返す。上限超過を区別したい場合のエラー種別は未確定。
7. **暗黙型変換の確定版** — `Value::to_number/to_boolean/to_text` は
   「直接引数」規則で実装済み（空文字→`#VALUE!`、`"5%"`→数値、
   `"TRUE"/"FALSE"`→真偽）。範囲参照由来の値に対する規則
   （例: `SUM` が文字列を無視する）は関数実装側で定義する。
8. **空白の字句的意味** — 式中の空白は Excel では積（intersection）
   演算子でもある。パーサーで intersection をサポートするかは PR 02 で
   扱う（現時点は字句上無視し、`A1 B2` はエラーとする方針を検討）。

## PR 02 (lexer / parser / AST)

9. **intersection 演算子（空白）と union 演算子（`,`）** — 現状、空白は
   字句的に無視されるため `A1 B2` は `UnexpectedToken` エラー。
   トップレベルの `,`（union 参照 `A1,B1`）も同様にエラー。
   サポートするかは互換性フィクスチャで需要を見て決める。
10. **`^` の結合性** — Excel は左結合（`2^3^2` = 64）として実装済み。
    数学慣習（右結合、512）と異なる点をフィクスチャで再確認する。
11. **配列リテラル `{1,2;3,4}`** — 計画 §4.3 で「後期」と明記。
    `{`/`}`/`;` は現状 lexer の `UnexpectedChar` エラー。
12. **暗黙積演算子 `@` および `#` スピル参照（`A1#`）** — 動的配列
    対応（PR 07）で検討。現状 `@` は `UnexpectedChar`、`A1#` は
    `#` 以降がエラーリテラルとして失敗し構文エラーになる。
13. **無限大・非数の数値リテラル** — `1e999` のようなオーバーフローする
    リテラルは `InvalidNumber` で拒否（Excel は `#NUM!` 相当の振る舞い）。
    エラー種別の写像を評価器実装時に確定する。
14. **`Missing` 引数ノードの意味論** — `F(a,,b)` の空引数は AST 上
    `Expr::Missing` で保持。各関数が省略時の既定値をどう解釈するかは
    関数実装側の仕様。
15. **`;` 引数区切り（ヨーロッパロケール）** — 非対応として明示エラー。
    ロケール対応方針が決まれば追加する。
16. **`S!A1:S!B2` の範囲第二端点のシート修飾** — PR 01 から継続。
    名前一致時に受理するかを Excel 実測で確認する。
## Phase 1 fixtures (Track B)

| Fixture id | Question |
|---|---|
| GEN-005 | LEFT character counting: UTF-16 code units vs Unicode scalars (non-BMP). |
| GEN-009 / GEN-010 | Result encoding for spilled array results (`SORT`/`UNIQUE`). Semantics fixed; representation pending. |
| P1-COUNTA-010 | Is an error produced inside a COUNTA argument counted like an error cell, or propagated? |
| P1-IF-012 | Blank cell as IF condition: coerce to FALSE (expected) or `#VALUE!`? |
| P1-AND-009 | AND/OR error propagation: does `AND(FALSE,1/0)` propagate or return FALSE? (Excel evaluates all args; expected propagation — confirm.) |
| P1-NOT-008 | Blank cell coercion for NOT (expected TRUE via blank->FALSE). |
| P1-ROUND-003 / P1-ROUND-009 | ROUND at binary half-way boundaries (1.005, 2.345): record Excel/LibreOffice empirically; never derive from Rust `round` alone (plan §10.2). |
| P1-ABS-009 | Blank referenced cell coerces to 0 (expected; confirm). |
| P1-IFERROR-009 | Blank referenced cell through IFERROR returns 0 (expected; confirm). |
| P1-IFERROR-011 | Missing `value_if_error`: parse-time arity error vs default 0. |
| (COUNT, no fixture yet) | COUNT over range of error cells: skipped vs propagated — add fixture after recording. |
| (NOT, no fixture yet) | `NOT("TRUE")`: is text-form boolean coerced? Expected `#VALUE!`. |
| (ROUND, no fixture yet) | Fractional `num_digits` truncation (`ROUND(1.234,1.9)`); huge `num_digits` clamping. |

## PR 03 (evaluator / dependency graph)

17. **Blank セルと他型の比較** — `=A1=0`（空白）は 0 と等しく、
    `=A1=""` とも比較されるよう Blank を比較相手の型のゼロ値として扱う
    暫定規則を採用。Excel の `=A1=""` → TRUE、`=A1=0` → TRUE の両立を
    フィクスチャで確認する。
18. **関数の引数数エラー** — arity 違反は暫定的に `#VALUE!` に写像。
    Excel は入力時点で拒否するため、セルエラーとして報告するか
    API エラーにするかを確定する。
19. **範囲引数の上限超過** — `MAX_ARRAY_CELLS` を超える範囲参照は
    `#VALUE!` を返す（エラー種別は PR 01 の項目 6 と同じく未確定）。
20. **循環参照の部分再計算** — dirty でない既評価セルは SCC 検査の
    対象外（既に確定済み値を持つ前提）。履歴のある大規模ブックで
    この前提が成立するか検証する。

## PR 04 (Phase 1 functions)

21. **単一セル参照の強制規則** — 集計関数は `A1` 形式の単一参照も
    範囲由来として扱い、text/boolean/blank を無視する
    （`SUM(A1)` で文字列セルは 0、と Excel 同様の想定）。要実測。
22. **`COUNTA` 直接引数エラー** — P1-COUNTA-010 は「伝播」で仮実装。
    「カウントする」に変わる場合あり。
23. **`IFERROR` の第2引数省略** — P1-IFERROR-011 は arity エラー
    （`#VALUE!`）で仮実装。Excel が入力時拒否なら API エラー側へ。
24. **`ROUND` の num_digits 非整数/巨大値** — trunc + ±320 クランプで
    仮実装。`ROUND(1.234,1.9)` の Excel 実測が必要。
25. **`NOT` の `"TRUE"/"FALSE"` 文字列** — 直接引数規則で強制
    （`NOT("TRUE")`→FALSE）。関数仕様の `#VALUE!` 予想と不整合、要実測。
26. **空の `Expr::Missing` 分岐** — `IF(FALSE,1,)` は Blank を返す
    （Excel は 0 の可能性）。要実測。
## Phase 2 fixtures (Track E)

`specOpen: true` cases in `tests/fixtures/golden-phase2.json` mirror the
table below. Shared criteria-grammar questions are flagged per fixture.

| Fixture id | Question |
|---|---|
| P2-SUMIF-009 | Blank-matching criteria: do `"="` and `""` match blank cells, empty strings, or both? Same question for `"<>"` in P2-COUNTIFS-010. |
| P2-SUMIF-013 | Does an error cell in `sum_range` at a non-matched position propagate or get ignored? |
| P2-COUNTIF-010 / P2-COUNTIFS-008 / P2-SUMIFS-013 | `""` criteria vs blank cells and empty strings — count rule unconfirmed. |
| P2-COUNTIF-013 | Error cell inside a criteria range: skipped (not counted) or propagated? Applies identically to SUMIF/SUMIFS/COUNTIFS. |
| P2-SUMIFS-006 | Error cell in `sum_range` at a matched position: expected `#DIV/0!` passthrough — confirm. |
| P2-SUMIFS-008 / P2-COUNTIFS-011 | `"*"` wildcard documented as matching text cells only; confirm it excludes numbers, blanks, booleans. |
| P2-SUMIFS-009 / P2-COUNTIFS-009 | Boolean criteria (`TRUE`) against boolean cells: equality expected — confirm. |
| P2-COUNTIFS-010 | `"<>"` non-blank criterion counting all non-blank cells — confirm. |
| P2-INDEX-005 / P2-INDEX-006 / P2-INDEX-011 | Index `0` / omitted column return whole row/column arrays in Excel; semantics for a non-spill engine undecided. |
| P2-INDEX-010 | Numeric-text index coercion (`"2"` → 2) expected; confirm. |
| P2-MATCH-011 | Boolean lookup under `match_type 0` — expected positional match; confirm. |
| P2-MATCH-012 | `match_type ±1` on unsorted data: Excel's binary-search result is order-dependent; must be recorded, not derived. |
| (docs only) | Even argument count to `SUMIFS`/`COUNTIFS` (missing criteria) — Excel arity error code mapping (likely `#VALUE!`). |
| (docs only) | Wildcards under `match_type ±1`: expected literal characters — confirm. |
| (docs only) | Error cell inside `MATCH` lookup_array during scan: propagate vs skip. |
