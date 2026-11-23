# COUNTIFS

`COUNTIFS(criteria_range1, criteria1, [criteria_range2, criteria2], ...)`
— counts positions where all criteria pairs match (logical AND).

## Arguments
- 1..127 `criteria_rangeN, criteriaN` pairs. All ranges must share the
  same dimensions, otherwise `#VALUE!` (documented Excel behavior).
- Odd argument count required; even count is an arity error
  (**SPEC-OPEN**: error code mapping, likely `#VALUE!`).

## Criteria grammar
Identical to `SUMIF.md`: operator prefixes, numeric operand coercion,
wildcards `*` `?` `~`, case-insensitive text, cell-reference criteria.

## Semantics
- AND of per-pair positional matches; returns a non-negative integer.
- `"*"` as a criterion counts text cells only (expected; confirm).
- Same range may appear in multiple pairs.

## Errors
- Mismatched range dimensions -> `#VALUE!`.
- Error in any `criteriaN` argument propagates.
- Error cells inside criteria ranges: skip vs propagate is
  **SPEC-OPEN**.

## Edge cases
- `COUNTIFS(A1:A3,">0",A1:A3,"<10")` — band counting on one range.
- Contradictory pairs -> `0`.

## Confirm against reference
- `"*"` excluding blanks/numbers.
- Boolean criteria against boolean cells.
- Error-in-range propagation.
