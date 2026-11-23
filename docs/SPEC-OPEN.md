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
