# SUMIFS

`SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)`
— sums `sum_range` cells where *all* criteria pairs match (logical AND).

## Arguments
- `sum_range`: range to sum. Required.
- `criteria_rangeN, criteriaN`: 1..127 pairs. All `criteria_rangeN` must
  have the same dimensions as `sum_range`, otherwise `#VALUE!`
  (documented Excel behavior; unlike `SUMIF` there is no resizing).
- Arity: total argument count must be odd and >= 3. Even counts are an
  arity error (**SPEC-OPEN**: Excel reports a generic arity failure —
  map to `#VALUE!`?).

## Criteria grammar
Identical to `SUMIF` (see `SUMIF.md`): operator prefixes
`=` `<>` `>` `>=` `<` `<=`, numeric coercion of the operand, wildcards
`*` `?` `~`, case-insensitive text, cell-reference criteria.

## Semantics
- Each `criteriaN` applies positionally to `criteria_rangeN`; a `sum_range`
  cell contributes only when every pair matches at its position.
- Text, boolean, and blank cells in criteria ranges follow the `SUMIF`
  rules (`"*"` matches any *text* cell — it does NOT match blanks or
  numbers; **confirm** against reference).
- Zero matches -> `0`.

## Errors
- Mismatched range dimensions -> `#VALUE!`.
- Error cell in `sum_range` at an all-matching position propagates.
- Error in a criteria argument propagates.
- Error *cell inside a criteria range*: propagate vs skip is
  **SPEC-OPEN** (same question as `SUMIF`).

## Edge cases
- Same range used for multiple pairs is legal
  (`SUMIFS(C1:C3,A1:A3,">0",A1:A3,"<10")`).
- Duplicate/contradictory criteria (`">5"` and `"<2"`) -> `0`, not an
  error.

## Confirm against reference
- `"*"` matching only text cells (expected: yes, blanks/numbers excluded).
- `TRUE`/`FALSE` as criteria against boolean cells.
- Error-in-criteria-range propagation.
