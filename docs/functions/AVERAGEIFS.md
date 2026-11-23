# AVERAGEIFS

`AVERAGEIFS(average_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)` — mean of `average_range` cells where *all* criteria
pairs match (logical AND).

## Arguments
- `average_range`: range to average. Required.
- `criteria_rangeN, criteriaN`: 1..127 pairs. All `criteria_rangeN`
  must have the same dimensions as `average_range`, otherwise
  `#VALUE!` (documented Excel behavior; no resizing, unlike
  `AVERAGEIF`).
- Arity: total argument count must be odd and >= 3.

## Criteria grammar
Identical to `SUMIF` (see `SUMIF.md`): operator prefixes `=` `<>` `>`
`>=` `<` `<=`, numeric coercion, wildcards `*` `?` `~`, case-insensitive
text.

## Semantics
- Each `criteriaN` applies positionally to `criteria_rangeN`; an
  `average_range` cell contributes only when every pair matches.
- Non-numeric (text/blank) `average_range` cells at matching positions
  are ignored in the mean.

## Errors
- Mismatched range dimensions -> `#VALUE!`.
- No matching positions with numeric values -> `#DIV/0!`.
- Error in a `criteria` argument propagates; error cells inside
  criteria ranges — propagate vs skip is **SPEC-OPEN** (same as
  `SUMIFS`).

## Examples
- `AVERAGEIFS({10,20,30,40},{1,2,1,2},1)` -> `20`
- `AVERAGEIFS(B1:B4,A1:A4,">=2",A1:A4,"<=3")` with B={5,15,25,35},
  A={1,2,3,4} -> `20`
- `AVERAGEIFS({1,2},{1,2},">5")` -> `#DIV/0!`
- `AVERAGEIFS(B1:B4,A1:A4,"x",C1:C5,"y")` (shape mismatch) -> `#VALUE!`

## Compatibility
- Excel 2007+.

## Open questions
- Error-cell-in-criteria-range propagation.
- Boolean `average_range` cells: ignored (expected, like `AVERAGE`).
