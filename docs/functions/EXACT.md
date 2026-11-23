# EXACT

`EXACT(text1, text2)` — returns `TRUE` if two text values are exactly
equal, comparing **case-sensitively**.

## Arguments
- `text1`, `text2`: required; each coerced to text first, THEN
  compared. Numbers, booleans, and blanks all coerce before
  comparison, so `EXACT` never compares raw types.

## Type coercion
- `Number` -> text-of-number: `EXACT(1,"1")` -> `TRUE`;
  `EXACT(TRUE,"TRUE")` -> `TRUE`.
- `Blank` -> `""`, so `EXACT(blank_cell,"")` -> `TRUE`.
- `Error` in either argument propagates.

## Semantics
- Case-sensitive on letters: `EXACT("abc","ABC")` -> `FALSE`.
- Trailing/leading spaces count: `EXACT("a","a ")` -> `FALSE`.
- Unicode normalization is NOT applied (Excel compares code-unit
  sequences — confirm): `"é"` precomposed vs `e`+combining accent ->
  `FALSE`.

## Errors
- Errors propagate.

## Examples
- `EXACT("word","word")` -> `TRUE`
- `EXACT("Word","word")` -> `FALSE`
- `EXACT(" a","a")` -> `FALSE`
- `EXACT(12,"12")` -> `TRUE`
- `EXACT(TRUE(),TRUE)` -> `TRUE`

## Compatibility
- All Excel versions; this is the only built-in case-sensitive
  comparison (along with `FIND`/`FINDB` for position search).

## Open questions
- Case-folding scope: ASCII-only vs Unicode-aware — verify behavior
  for e.g. `EXACT("ß","SS")` (expected `FALSE`) and accented case
  pairs (expected sensitive).
- Composed vs decomposed Unicode equality (expected raw, no NFC/NFD).
