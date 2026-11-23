# Changelog

All notable changes to rust-math-engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] / 0.1.0

First development line: the v1 core plus the full v2 function set
(100 functions, `docs/FUNCTION_PLAN_V2.md`).

### Added — core engine

- `calc-core`: value model (`Number`/`Text`/`Boolean`/`Blank`/`Error`/
  `Array`/`Lambda`), A1 lexer/Pratt parser with structured errors and
  input limits, workbook with multiple sheets, and `CalcEngine`.
- Dependency graph with iterative Tarjan SCC cycle detection (`#CIRC!`)
  and topological evaluation order.
- **Differential recalculation**: edits dirty only the changed cell's
  transitive dependents, backed by a reverse dependency index
  (`rev_cells` + per-sheet range watchers) and a per-sheet sorted member
  index for range-edge expansion.
- Volatile functions (`RAND`, `RANDBETWEEN`, `TODAY`, `NOW`) re-evaluate
  every `recalculate()` pass, including their dependents, via an
  incrementally maintained volatile set; clock and RNG are injectable.
- Dynamic-array spilling: atomic spill writes, `#SPILL!` on obstruction,
  resize/shrink re-dirtying dependents of spilled cells.
- `LET`/`LAMBDA` closures with scopes, `Invoke` evaluation, step budget
  (`MAX_EVAL_STEPS`) and depth limits.

### Added — functions (100)

- **aggregate (12):** SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT,
  SUMIF, SUMIFS, COUNTIF, COUNTIFS, SUMPRODUCT.
- **logical (9):** IF, AND, OR, NOT, IFERROR, IFS, SWITCH, ISNUMBER,
  ISTEXT.
- **math (13):** ROUND, ABS, MOD, INT, TRUNC, POWER, CEILING.MATH,
  FLOOR.MATH, LOG, EXP, SQRT, RAND, RANDBETWEEN.
- **lookup (11):** INDEX, MATCH, XLOOKUP, VLOOKUP, HLOOKUP, LOOKUP,
  CHOOSE, ROW, COLUMN, ROWS, COLUMNS.
- **text (16):** LEFT, RIGHT, MID, LEN, TRIM, CONCAT, UPPER, LOWER,
  PROPER, TEXT, VALUE, FIND, SEARCH, SUBSTITUTE, REPLACE, TEXTJOIN.
- **datetime (12):** TODAY, DATE, NOW, TIME, YEAR, MONTH, DAY, HOUR,
  MINUTE, SECOND, EDATE, EOMONTH.
- **statistics (12):** STDEV.S, VAR.S, MEDIAN, CORREL, LARGE, SMALL,
  PERCENTILE.INC, QUARTILE.INC, RANK.EQ, MODE.SNGL, SLOPE, INTERCEPT.
- **array (11):** FILTER, SORT, UNIQUE, SEQUENCE, TRANSPOSE, TAKE, DROP,
  VSTACK, HSTACK, TOCOL, TOROW.
- **functional (4):** LET, LAMBDA, MAP, REDUCE.

### Added — infrastructure

- `calc-cli` (`eval` command) and `calc-wasm` batch-API boundary.
- Golden fixture suite (`tests/fixtures/golden-*.json`, FORMAT.md
  format, `validate.py`) wired into `golden_*` test harnesses.
- Criterion benchmarks: `parse_bench` and `recalc_bench` (plan §11
  scenarios: initial calc, single-cell / 1% / full change).
- `end_to_end` example (spill + LAMBDA + lookup + differential recalc).
- Fuzz scaffold (`fuzz/`, excluded from the workspace).

### Performance

- Recalculation hot paths moved from O(#formulas × #visited) to
  O(out-degree + range watchers): a single edit on a 10k-cell chain went
  from ~648 ms to ~29.5 ms; a full 10k-cell touch from ~1.30 s to ~28 ms
  (x86-64, criterion).

### Known limitations / open items

- Undecided Excel-compat points are tracked in `docs/SPEC-OPEN.md`
  (e.g. intersection/union operators, `#`-spill references, whole-column
  references, locale-dependent `TEXT`/`VALUE` details); uncertain fixture
  expectations are marked `"specOpen": true` rather than guessed.
- License: MIT text vendored; `MIT OR Apache-2.0` dual licensing pending
  a maintainer decision.
