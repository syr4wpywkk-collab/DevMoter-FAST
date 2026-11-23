# COUNTBLANK

`COUNTBLANK(range)` — count of empty cells and cells containing `""`
(empty text) in a range.

## Arguments
- `range`: required; a single range or array reference. Scalar
  non-reference arguments: Excel requires a range — passing a literal
  raises an error (**confirm kind**: `#VALUE!`?).

## Semantics
- Counts: truly empty cells and formula/string results equal to `""`.
- Does NOT count: numbers (including `0`), booleans, error cells, text
  with any characters (even `" "` spaces).
- Multi-area references / unions: behavior **SPEC-OPEN**.

## Examples
- `COUNTBLANK(A1:B3)` with A1="" (formula), B2=empty, others 0/"x" ->
  `2`
- `COUNTBLANK(A1:A3)` with {0," ",""} -> `1`
- `COUNTBLANK(A1:A1)` with a numeric cell -> `0`

## Compatibility
- Available since early Excel versions; also counts empty-string
  results (added in Excel 2010 for `""`; older versions counted only
  true blanks — **confirm**).

## Engine requirements
- Cell-level "is blank" vs "is empty string" distinction (see
  `Value::Blank` vs `Text("")` in the plan §3.1).

## Open questions
- Literal/array argument handling.
- Whether `""` produced by a formula counts (expected yes).
- Multi-area range support.
