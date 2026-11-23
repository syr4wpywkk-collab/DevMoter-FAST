# DevMoter Calc Engine — 100関数拡張・実装詳細計画書 v2.0

策定日: 2026-11-23 / 状態: 設計案・未実装 / 前提: v1.0の38関数を維持し、追加62関数を実装する。

## 0. エグゼクティブ判断

- **範囲:** 第1次38 + 第2次50 + 第3次12 = **100種類（重複なし）**。
- **方針:** Rust stable、1関数1ファイル、意味論・条件判定・文字列・日付・配列・エラー・参照は共通化。UI、XLSX I/O、計算コアを分離。
- **互換性:** Excel準拠を目標とするが、完全互換は約束しない。サポートする関数の引数、暗黙型変換、エラー優先順位、配列、日付体系をバージョン付き仕様に記述。
- **開発順序:** 基盤→基本演算→条件集計→文字列→検索→日時/統計→配列→高階関数→性能/統合。PR単位でCI合格、レビュー後にマージ判断。
- **公開:** 独立OSSを想定するが、ライセンス・依存関係・CI・品質基準は別途承認。

## 1. 関数の正規一覧（100件）

| # | 関数 | 区分 | 実装領域 | 難度 | ファイル |
|---:|---|---|---|---|---|
| 1 | `SUM` | 第1次 | aggregate | 低〜中 | `aggregate/sum.rs` |
| 2 | `AVERAGE` | 第1次 | aggregate | 低〜中 | `aggregate/average.rs` |
| 3 | `MIN` | 第1次 | aggregate | 低〜中 | `aggregate/min.rs` |
| 4 | `MAX` | 第1次 | aggregate | 低〜中 | `aggregate/max.rs` |
| 5 | `COUNT` | 第1次 | aggregate | 低〜中 | `aggregate/count.rs` |
| 6 | `COUNTA` | 第1次 | aggregate | 低〜中 | `aggregate/counta.rs` |
| 7 | `IF` | 第1次 | logical | 低〜中 | `logical/if.rs` |
| 8 | `AND` | 第1次 | logical | 低〜中 | `logical/and.rs` |
| 9 | `OR` | 第1次 | logical | 低〜中 | `logical/or.rs` |
| 10 | `NOT` | 第1次 | logical | 低〜中 | `logical/not.rs` |
| 11 | `ROUND` | 第1次 | math | 低〜中 | `math/round.rs` |
| 12 | `ABS` | 第1次 | math | 低〜中 | `math/abs.rs` |
| 13 | `IFERROR` | 第1次 | logical | 低〜中 | `logical/iferror.rs` |
| 14 | `SUMIF` | 第1次 | aggregate | 中 | `aggregate/sumif.rs` |
| 15 | `SUMIFS` | 第1次 | aggregate | 中 | `aggregate/sumifs.rs` |
| 16 | `COUNTIF` | 第1次 | aggregate | 中 | `aggregate/countif.rs` |
| 17 | `COUNTIFS` | 第1次 | aggregate | 中 | `aggregate/countifs.rs` |
| 18 | `XLOOKUP` | 第1次 | lookup | 高 | `lookup/xlookup.rs` |
| 19 | `INDEX` | 第1次 | lookup | 中 | `lookup/index.rs` |
| 20 | `MATCH` | 第1次 | lookup | 中 | `lookup/match.rs` |
| 21 | `LEFT` | 第1次 | text | 低〜中 | `text/left.rs` |
| 22 | `RIGHT` | 第1次 | text | 低〜中 | `text/right.rs` |
| 23 | `MID` | 第1次 | text | 低〜中 | `text/mid.rs` |
| 24 | `LEN` | 第1次 | text | 低〜中 | `text/len.rs` |
| 25 | `TRIM` | 第1次 | text | 低〜中 | `text/trim.rs` |
| 26 | `CONCAT` | 第1次 | text | 低〜中 | `text/concat.rs` |
| 27 | `FILTER` | 第1次 | array | 高 | `array/filter.rs` |
| 28 | `SORT` | 第1次 | array | 高 | `array/sort.rs` |
| 29 | `UNIQUE` | 第1次 | array | 高 | `array/unique.rs` |
| 30 | `STDEV.S` | 第1次 | statistics | 中 | `statistics/stdev_s.rs` |
| 31 | `VAR.S` | 第1次 | statistics | 中 | `statistics/var_s.rs` |
| 32 | `MEDIAN` | 第1次 | statistics | 低〜中 | `statistics/median.rs` |
| 33 | `CORREL` | 第1次 | statistics | 中 | `statistics/correl.rs` |
| 34 | `LOG` | 第1次 | math | 低〜中 | `math/log.rs` |
| 35 | `EXP` | 第1次 | math | 低〜中 | `math/exp.rs` |
| 36 | `SQRT` | 第1次 | math | 低〜中 | `math/sqrt.rs` |
| 37 | `TODAY` | 第1次 | datetime | 低〜中 | `datetime/today.rs` |
| 38 | `DATE` | 第1次 | datetime | 低〜中 | `datetime/date.rs` |
| 39 | `PRODUCT` | 第2次 | aggregate | 低〜中 | `aggregate/product.rs` |
| 40 | `MOD` | 第2次 | math | 低〜中 | `math/mod.rs` |
| 41 | `INT` | 第2次 | math | 低〜中 | `math/int.rs` |
| 42 | `TRUNC` | 第2次 | math | 低〜中 | `math/trunc.rs` |
| 43 | `POWER` | 第2次 | math | 低〜中 | `math/power.rs` |
| 44 | `CEILING.MATH` | 第2次 | math | 低〜中 | `math/ceiling_math.rs` |
| 45 | `FLOOR.MATH` | 第2次 | math | 低〜中 | `math/floor_math.rs` |
| 46 | `RAND` | 第2次 | math | 高 | `math/rand.rs` |
| 47 | `RANDBETWEEN` | 第2次 | math | 高 | `math/randbetween.rs` |
| 48 | `SUMPRODUCT` | 第2次 | aggregate | 高 | `aggregate/sumproduct.rs` |
| 49 | `VLOOKUP` | 第2次 | lookup | 中 | `lookup/vlookup.rs` |
| 50 | `HLOOKUP` | 第2次 | lookup | 中 | `lookup/hlookup.rs` |
| 51 | `LOOKUP` | 第2次 | lookup | 中 | `lookup/lookup.rs` |
| 52 | `CHOOSE` | 第2次 | lookup | 中 | `lookup/choose.rs` |
| 53 | `ROW` | 第2次 | lookup | 低〜中 | `lookup/row.rs` |
| 54 | `COLUMN` | 第2次 | lookup | 低〜中 | `lookup/column.rs` |
| 55 | `ROWS` | 第2次 | lookup | 低〜中 | `lookup/rows.rs` |
| 56 | `COLUMNS` | 第2次 | lookup | 低〜中 | `lookup/columns.rs` |
| 57 | `TEXT` | 第2次 | text | 高 | `text/text.rs` |
| 58 | `VALUE` | 第2次 | text | 高 | `text/value.rs` |
| 59 | `FIND` | 第2次 | text | 低〜中 | `text/find.rs` |
| 60 | `SEARCH` | 第2次 | text | 低〜中 | `text/search.rs` |
| 61 | `SUBSTITUTE` | 第2次 | text | 低〜中 | `text/substitute.rs` |
| 62 | `REPLACE` | 第2次 | text | 低〜中 | `text/replace.rs` |
| 63 | `UPPER` | 第2次 | text | 低〜中 | `text/upper.rs` |
| 64 | `LOWER` | 第2次 | text | 低〜中 | `text/lower.rs` |
| 65 | `PROPER` | 第2次 | text | 低〜中 | `text/proper.rs` |
| 66 | `TEXTJOIN` | 第2次 | text | 中 | `text/textjoin.rs` |
| 67 | `NOW` | 第2次 | datetime | 高 | `datetime/now.rs` |
| 68 | `TIME` | 第2次 | datetime | 低〜中 | `datetime/time.rs` |
| 69 | `YEAR` | 第2次 | datetime | 低〜中 | `datetime/year.rs` |
| 70 | `MONTH` | 第2次 | datetime | 低〜中 | `datetime/month.rs` |
| 71 | `DAY` | 第2次 | datetime | 低〜中 | `datetime/day.rs` |
| 72 | `HOUR` | 第2次 | datetime | 低〜中 | `datetime/hour.rs` |
| 73 | `MINUTE` | 第2次 | datetime | 低〜中 | `datetime/minute.rs` |
| 74 | `SECOND` | 第2次 | datetime | 低〜中 | `datetime/second.rs` |
| 75 | `EDATE` | 第2次 | datetime | 中 | `datetime/edate.rs` |
| 76 | `EOMONTH` | 第2次 | datetime | 中 | `datetime/eomonth.rs` |
| 77 | `LARGE` | 第2次 | statistics | 低〜中 | `statistics/large.rs` |
| 78 | `SMALL` | 第2次 | statistics | 低〜中 | `statistics/small.rs` |
| 79 | `PERCENTILE.INC` | 第2次 | statistics | 低〜中 | `statistics/percentile_inc.rs` |
| 80 | `QUARTILE.INC` | 第2次 | statistics | 低〜中 | `statistics/quartile_inc.rs` |
| 81 | `RANK.EQ` | 第2次 | statistics | 低〜中 | `statistics/rank_eq.rs` |
| 82 | `MODE.SNGL` | 第2次 | statistics | 低〜中 | `statistics/mode_sngl.rs` |
| 83 | `SLOPE` | 第2次 | statistics | 中 | `statistics/slope.rs` |
| 84 | `INTERCEPT` | 第2次 | statistics | 中 | `statistics/intercept.rs` |
| 85 | `IFS` | 第2次 | logical | 中 | `logical/ifs.rs` |
| 86 | `SWITCH` | 第2次 | logical | 中 | `logical/switch.rs` |
| 87 | `ISNUMBER` | 第2次 | logical | 低〜中 | `logical/isnumber.rs` |
| 88 | `ISTEXT` | 第2次 | logical | 低〜中 | `logical/istext.rs` |
| 89 | `SEQUENCE` | 第3次 | array | 高 | `array/sequence.rs` |
| 90 | `TRANSPOSE` | 第3次 | array | 高 | `array/transpose.rs` |
| 91 | `TAKE` | 第3次 | array | 高 | `array/take.rs` |
| 92 | `DROP` | 第3次 | array | 高 | `array/drop.rs` |
| 93 | `VSTACK` | 第3次 | array | 高 | `array/vstack.rs` |
| 94 | `HSTACK` | 第3次 | array | 高 | `array/hstack.rs` |
| 95 | `TOCOL` | 第3次 | array | 高 | `array/tocol.rs` |
| 96 | `TOROW` | 第3次 | array | 高 | `array/torow.rs` |
| 97 | `LET` | 第3次 | functional | 高 | `functional/let.rs` |
| 98 | `LAMBDA` | 第3次 | functional | 高 | `functional/lambda.rs` |
| 99 | `MAP` | 第3次 | functional | 高 | `functional/map.rs` |
| 100 | `REDUCE` | 第3次 | functional | 高 | `functional/reduce.rs` |

## 2. 追加62関数の具体的実装仕様

- **039 `PRODUCT`** (`aggregate/product.rs`): 数値引数の積。空白・文字列・配列中の文字列の扱いを互換性試験で固定。
- **040 `MOD`** (`math/mod.rs`): 除数ゼロ、負数の符号規則をExcelに合わせる。Rustの%をそのまま使わない。
- **041 `INT`** (`math/int.rs`): 負数は負の無限大方向へ切り下げ。
- **042 `TRUNC`** (`math/trunc.rs`): ゼロ方向に切り捨て。桁数引数対応。
- **043 `POWER`** (`math/power.rs`): 負数の非整数乗、0の0乗、オーバーフロー、#NUM!を検証。
- **044 `CEILING.MATH`** (`math/ceiling_math.rs`): significanceとmodeの符号規則、負数の丸め方向。
- **045 `FLOOR.MATH`** (`math/floor_math.rs`): significanceとmodeの符号規則、負数の丸め方向。
- **046 `RAND`** (`math/rand.rs`): ワークブックごとの乱数源とvolatile再計算。テストではseed固定。
- **047 `RANDBETWEEN`** (`math/randbetween.rs`): 整数境界、上下逆転時のエラー、乱数偏りを回避。
- **048 `SUMPRODUCT`** (`aggregate/sumproduct.rs`): 同形配列検証、要素ごとの乗算と総和、型変換。
- **049 `VLOOKUP`** (`lookup/vlookup.rs`): 完全一致/近似一致、表範囲、列番号、ソート前提。
- **050 `HLOOKUP`** (`lookup/hlookup.rs`): 横方向のVLOOKUP相当、行番号と近似一致。
- **051 `LOOKUP`** (`lookup/lookup.rs`): ベクトル/配列形式、近似一致の前提と境界。
- **052 `CHOOSE`** (`lookup/choose.rs`): インデックスに応じた分岐。未選択引数の遅延評価。
- **053 `ROW`** (`lookup/row.rs`): 参照の行番号。配列参照時の返却形状。
- **054 `COLUMN`** (`lookup/column.rs`): 参照の列番号。配列参照時の返却形状。
- **055 `ROWS`** (`lookup/rows.rs`): 参照または配列の行数。
- **056 `COLUMNS`** (`lookup/columns.rs`): 参照または配列の列数。
- **057 `TEXT`** (`text/text.rs`): 書式コードのサブセットを明示。日付/数値/ロケール差に注意。
- **058 `VALUE`** (`text/value.rs`): 数値文字列の解析、区切り文字、日付解釈のロケール固定。
- **059 `FIND`** (`text/find.rs`): 大文字小文字を区別。Excel互換の1始まり位置。
- **060 `SEARCH`** (`text/search.rs`): 大文字小文字を区別しない。ワイルドカード対応。
- **061 `SUBSTITUTE`** (`text/substitute.rs`): 指定した出現回数のみ置換可能。
- **062 `REPLACE`** (`text/replace.rs`): 文字位置による置換。文字列長の扱いを統一。
- **063 `UPPER`** (`text/upper.rs`): Unicodeの大文字化とExcelとの相違をフィクスチャ化。
- **064 `LOWER`** (`text/lower.rs`): Unicodeの小文字化とExcelとの相違をフィクスチャ化。
- **065 `PROPER`** (`text/proper.rs`): 単語境界とUnicodeの扱いを明文化。
- **066 `TEXTJOIN`** (`text/textjoin.rs`): 区切り文字、空白無視、配列のフラット化、長さ制限。
- **067 `NOW`** (`datetime/now.rs`): 時計注入、タイムゾーン、volatile扱い。
- **068 `TIME`** (`datetime/time.rs`): 時分秒の正規化、日付シリアル小数部。
- **069 `YEAR`** (`datetime/year.rs`): 1900/1904日付体系と日付シリアル変換。
- **070 `MONTH`** (`datetime/month.rs`): 日付シリアル変換と範囲検証。
- **071 `DAY`** (`datetime/day.rs`): 日付シリアル変換と範囲検証。
- **072 `HOUR`** (`datetime/hour.rs`): 小数日の時刻成分。
- **073 `MINUTE`** (`datetime/minute.rs`): 小数日の分成分。
- **074 `SECOND`** (`datetime/second.rs`): 小数日の秒成分。
- **075 `EDATE`** (`datetime/edate.rs`): 月末繰り上げ・うるう年・負の月数。
- **076 `EOMONTH`** (`datetime/eomonth.rs`): 月末日計算・うるう年・負の月数。
- **077 `LARGE`** (`statistics/large.rs`): k番目の大きい値、範囲外k、重複値。
- **078 `SMALL`** (`statistics/small.rs`): k番目の小さい値、範囲外k、重複値。
- **079 `PERCENTILE.INC`** (`statistics/percentile_inc.rs`): 線形補間、k∈[0,1]、空集合。
- **080 `QUARTILE.INC`** (`statistics/quartile_inc.rs`): PERCENTILE.INCとの整合性、quart 0〜4。
- **081 `RANK.EQ`** (`statistics/rank_eq.rs`): 同順位、昇順/降順、非数値入力。
- **082 `MODE.SNGL`** (`statistics/mode_sngl.rs`): 同頻度時の返却規則、最頻値なし。
- **083 `SLOPE`** (`statistics/slope.rs`): 回帰傾き、ゼロ分散、非数値ペアの除外。
- **084 `INTERCEPT`** (`statistics/intercept.rs`): 回帰切片、ゼロ分散、ペア整合性。
- **085 `IFS`** (`logical/ifs.rs`): 条件と値のペア、左から評価、未選択分岐を評価しない。
- **086 `SWITCH`** (`logical/switch.rs`): 比較対象と候補、既定値、未選択分岐を評価しない。
- **087 `ISNUMBER`** (`logical/isnumber.rs`): 数値型判定。文字列数値を暗黙変換しない。
- **088 `ISTEXT`** (`logical/istext.rs`): 文字列型判定。空白・エラーを区別。
- **089 `SEQUENCE`** (`array/sequence.rs`): 行列サイズ、開始値、増分、スピル上限。
- **090 `TRANSPOSE`** (`array/transpose.rs`): 行列の行列軸交換、空配列/1xN/Nx1。
- **091 `TAKE`** (`array/take.rs`): 正負の行列数、ゼロ指定の挙動。
- **092 `DROP`** (`array/drop.rs`): 正負の行列数、結果空配列の挙動。
- **093 `VSTACK`** (`array/vstack.rs`): 列数不一致時のパディングと#N/A。
- **094 `HSTACK`** (`array/hstack.rs`): 行数不一致時のパディングと#N/A。
- **095 `TOCOL`** (`array/tocol.rs`): 行列フラット化順序、空白/エラー無視指定。
- **096 `TOROW`** (`array/torow.rs`): 行列フラット化順序、空白/エラー無視指定。
- **097 `LET`** (`functional/let.rs`): 名前の束縛、スコープ、シャドーイング、評価順序。
- **098 `LAMBDA`** (`functional/lambda.rs`): クロージャ環境、引数束縛、再帰上限。
- **099 `MAP`** (`functional/map.rs`): 配列を要素ごとにLAMBDAへ渡す、形状検証。
- **100 `REDUCE`** (`functional/reduce.rs`): 初期値とアキュムレータ、順序、実行予算。

## 3. 共有基盤と依存関係

```text
crates/
  calc-core/src/
    ast.rs parser.rs lexer.rs value.rs error.rs workbook.rs
    reference.rs evaluator.rs dependency.rs scheduler.rs
    array.rs spill.rs budget.rs trace.rs semantics.rs
  calc-functions/src/
    registry.rs
    common/{coercion,criteria,compare,number,date_serial,text_index,lookup,statistics,random}.rs
    aggregate/*.rs logical/*.rs lookup/*.rs text/*.rs
    array/*.rs statistics/*.rs math/*.rs datetime/*.rs functional/*.rs
  calc-wasm/src/lib.rs
  calc-cli/src/main.rs
tests/{fixtures,compatibility,properties,integration}/
benches/
```

**依存関係の制約:** `calc-core`が`calc-functions`を直接参照しない。関数実装は`Function` traitで登録し、循環依存を作らない。`IF`/`IFS`/`SWITCH`/`CHOOSE`/`LET`/`LAMBDA`は評価器に遅延引数・スコープの能力を要求する。

**値モデル:** Number / Text / Boolean / Blank / Error / Array / Reference / Lambda。数値は当初f64とし、NaN/Infinityの表現をExcel系エラーに正規化。空白と空文字は区別。

**実行制限:** 最大式長、ASTノード数、再帰深度、参照セル数、配列セル数、計算時間・演算ステップを制限し、失敗時はクラッシュではなく定義済みエラーを返す。

## 4. PR計画（16本、関数の担当重複なし）

| PR | スコープ | 関数数 | 完了条件 |
|---|---|---:|---|
| PR00 | 基盤・仕様固定 | 0 | 仕様・共通基盤テスト合格 |
| PR01 | 集計 | 7 | `SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT` の単体・境界・エラーテスト合格 |
| PR02 | 論理 | 9 | `IF, AND, OR, NOT, IFERROR, IFS, SWITCH, ISNUMBER, ISTEXT` の単体・境界・エラーテスト合格 |
| PR03 | 数値 | 11 | `ROUND, ABS, MOD, INT, TRUNC, POWER, CEILING.MATH, FLOOR.MATH, LOG, EXP, SQRT` の単体・境界・エラーテスト合格 |
| PR04 | 条件付き集計 | 5 | `SUMIF, SUMIFS, COUNTIF, COUNTIFS, SUMPRODUCT` の単体・境界・エラーテスト合格 |
| PR05 | 文字列前半 | 9 | `LEFT, RIGHT, MID, LEN, TRIM, CONCAT, UPPER, LOWER, PROPER` の単体・境界・エラーテスト合格 |
| PR06 | 文字列後半 | 7 | `TEXT, VALUE, FIND, SEARCH, SUBSTITUTE, REPLACE, TEXTJOIN` の単体・境界・エラーテスト合格 |
| PR07 | 検索参照 | 11 | `INDEX, MATCH, XLOOKUP, VLOOKUP, HLOOKUP, LOOKUP, CHOOSE, ROW, COLUMN, ROWS, COLUMNS` の単体・境界・エラーテスト合格 |
| PR08 | 日付時刻 | 12 | `TODAY, DATE, NOW, TIME, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, EDATE, EOMONTH` の単体・境界・エラーテスト合格 |
| PR09 | 統計 | 12 | `STDEV.S, VAR.S, MEDIAN, CORREL, LARGE, SMALL, PERCENTILE.INC, QUARTILE.INC, RANK.EQ, MODE.SNGL, SLOPE, INTERCEPT` の単体・境界・エラーテスト合格 |
| PR10 | 動的配列 | 11 | `FILTER, SORT, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP, VSTACK, HSTACK, TOCOL, TOROW` の単体・境界・エラーテスト合格 |
| PR11 | 乱数 | 2 | `RAND, RANDBETWEEN` の単体・境界・エラーテスト合格 |
| PR12 | 高階式 | 4 | `LET, LAMBDA, MAP, REDUCE` の単体・境界・エラーテスト合格 |
| PR13 | 差分再計算・性能 | 0 | 仕様・共通基盤テスト合格 |
| PR14 | WASM・連携 | 0 | 仕様・共通基盤テスト合格 |
| PR15 | 出荷品質 | 0 | 仕様・共通基盤テスト合格 |

**PR順序の補足:** PR13の差分再計算はPR00から最小実装を先行させ、PR13で性能最適化する。PR10の動的配列はPR07より後。PR12のLAMBDAは評価器の遅延評価・スコープ設計の完了後。PR11のRANDはvolatile再計算が前提。

## 5. テスト仕様と品質ゲート

| テスト層 | 最低目標 | 内容 |
|---|---:|---|
| 各関数単体 | 1,000 | 100関数×10ケース以上、引数・型・境界・エラー・空白 |
| 解析器・型・参照 | 200 | 優先順位、絶対/相対参照、範囲、文字列、構文エラー |
| 相互連携 | 150 | ネスト、IF遅延評価、検索×配列、集計×条件 |
| 差分再計算・スピル | 150 | dirty伝播、循環参照、衝突、複数シート |
| Excel/LibreOffice差分 | 500 | 関数ごとの既知互換フィクスチャ、参照製品バージョン記録 |
| WASM/CLI/API | 100 | 同一結果、エラー、メモリ解放、シリアライズ |
| セキュリティ/ファズ | 100 | 巨大式、悪意ある入力、上限、パニックなし |
| **合計** | **2,200以上** | 重複を除くテストケース目標。実施済みではない |

**合否:** CI全緑、未説明の互換性差分0、クラッシュ0、原本XLSX破損0、重大な性能退行0。未対応のExcel仕様は文書化し、黙って誤った結果を返さない。

### 5.1 必須フィクスチャ例

```text
=INT(-1.2)                => -2
=TRUNC(-1.2)              => -1
=MOD(-3,2)                => 1
=IF(FALSE,1/0,42)         => 42
=IFERROR(1/0,99)          => 99
=SEQUENCE(2,3,1,1)        => [[1,2,3],[4,5,6]]
=TRANSPOSE({1,2;3,4})     => [[1,3],[2,4]] (配列リテラル構文対応後)
=LET(x,2,x^3)             => 8
=REDUCE(0,{1,2,3},LAMBDA(a,v,a+v)) => 6
```

日付/書式/文字列のExcel挙動はロケール、日付体系、Unicode処理に依存するため、参照実装の実測フィクスチャを正とする。上の例は仕様検証用の目標値であり、実装済みを意味しない。

## 6. 性能計画（Rust/WASM）

- 基準環境: ARM64 Debian Chromebook、x86-64 Linux、iPhone Safari相当のモバイルブラウザ。ハードウェア・ビルド条件・入力データを記録。
- 計測サイズ: 1千/1万/10万/100万セル、cold/warm、変更1セル/1%/10%、配列関数の出力サイズ別。
- 指標: p50/p95実行時間、最大常駐メモリ、WASM起動時間、GC/メモリ解放、再計算セル数、正確性。
- SORT: 一般的な比較ソートはO(n log n)。平衡木などの**索引1件更新**はO(log n)を目標にできるが、**全件出力・セル反映**にはO(n)以上必要。結果の安定性は元行番号を第二キーに使って担保。
- 数値演算/小規模配列ではWASM境界コストが支配的になり得るため、APIはセル単位の大量往復ではなく一括操作を優先。
- 性能の絶対値目標はベースライン計測後に設定し、事前に根拠のないミリ秒保証を置かない。

## 7. API設計

```rust
pub struct Workbook { /* private */ }
pub enum CalcValue { Number(f64), Text(String), Bool(bool), Blank, Error(CalcError), Array(Vec<Vec<CalcValue>>) }
impl Workbook {
    pub fn set_cell(&mut self, sheet: &str, addr: &str, input: &str) -> Result<(), CalcError>;
    pub fn get_value(&mut self, sheet: &str, addr: &str) -> Result<CalcValue, CalcError>;
    pub fn recalculate(&mut self) -> Result<RecalcReport, CalcError>;
    pub fn explain(&self, sheet: &str, addr: &str) -> Result<EvaluationTrace, CalcError>;
}
```

上記は公開APIの**草案**。参照型や配列所有権、キャッシュの不変条件、WASMシリアライズを検証後に固定する。`explain`は参照・評価手順を説明する構造化トレースであり、AIへの無制限なファイルアクセス権を与えない。

## 8. 開発管理・承認

1. CEOが100関数のスコープ・互換性基準・OSS公開方針を承認。
2. PR00で設計決定記録（ADR）を作り、値・日付・型変換・動的配列の仕様を固定。
3. 関数ごとに1ファイル＋隣接テスト。共通処理の重複はコードレビューで拒否。
4. PRごとにfmt、clippy、unit、property、compatibility、WASM smokeを実行。
5. 互換性差分、性能、残存リスクをPRに記録。レビュー後、CEO承認に従いマージ。
6. DevMoter FASTへの組込み・本番デプロイは独立した承認事項とする。

## 9. リスクと回避策

| リスク | 対策 |
|---|---|
| Excel独特の暗黙変換 | 共通coercion層と関数別の互換性フィクスチャ |
| 日付1900年問題・1904年方式 | 日付シリアルを独立モジュール化し、設定可能にする |
| TEXTの書式コードの膨大さ | 明示的なサブセットから段階拡張、未対応書式を識別 |
| RAND/NOW/TODAYの非決定性 | 時計と乱数源を注入し、volatile再計算を設計 |
| 動的配列のスピル衝突 | 事前検査・原子的反映・#SPILL!の一貫した扱い |
| LAMBDA/MAP/REDUCEの計算爆発 | 深度・ステップ・メモリ予算を強制 |
| AIによる大量書換え | トランザクション、差分プレビュー、権限確認、取り消し |
| 100関数の保守負担 | 共通意味論、1関数1ファイル、契約テスト、所有者明記 |

## 10. リリース段階

- **v0.1:** コア・基本13関数・セル参照・循環検出。
- **v0.2:** 第1次38関数の仕様対応。
- **v0.3:** 数学・集計・文字列・検索の第2次関数。
- **v0.4:** 日付・統計・乱数の第2次関数。
- **v0.5:** 88関数到達、差分再計算とWASMスモーク。
- **v0.6:** 動的配列の第3次8関数、LET/LAMBDA/MAP/REDUCEの4関数。100関数到達。
- **v0.7:** Excel/LibreOffice差分、パフォーマンス、メモリ・セキュリティ強化。
- **v1.0:** 宣言した対応範囲で品質ゲートを満たした場合のみ正式公開。

---
**注記:** この文書は実装案であり、リポジトリ編集、PR作成、テスト実行、互換性検証はまだ実施していない。
