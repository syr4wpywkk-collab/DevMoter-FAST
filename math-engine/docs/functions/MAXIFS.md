# MAXIFS

`MAXIFS(max_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)`
— maximum of `max_range` cells where *all* criteria pairs match.
Excel 2019+ / Microsoft 365.

## Arguments
- `max_range`: required range to take the max of.
- `criteria_rangeN, criteriaN`: 1..126 pairs; all criteria ranges must
  match `max_range` in dimensions, else `#VALUE!`.

## Criteria grammar
Identical to `SUMIFS`/`COUNTIFS` (see `SUMIFS.md`): operator prefixes
`=` `<>` `>` `>=` `<` `<=`, numeric coercion of operand, wildcards
`*` `?` `~` on text, case-insensitive text comparison, cell-ref
criteria.

## Semantics
- Positional AND across all pairs, like `SUMIFS`.
- Only numeric cells in `max_range` participate; text/blank at matching
  positions are ignored? — Excel docs say non-numeric cells are
  ignored, so if matching positions hold only text/blank, result is
  `0` (not `#VALUE!`).

## Errors
- Mismatched range dims -> `#VALUE!`.
- Criteria argument errors propagate; error cells in `max_range` at
  matching positions propagate.
- **No matching cells -> `0`** (documented Excel behavior, NOT an
  error — unlike `MIN`/`MAX` over empty set behavior debates).

## Examples
- `MAXIFS(B1:B4, A1:A4, ">10")` with `A=11,5,12,9`, `B=1,2,3,4` -> `3`.
- `MAXIFS(C1:C3, A1:A3, "x", B1:B3, ">0")` -> max of C where A="x" and
  B>0.
- `MAXIFS(A1:A3, B1:B3, "zzz")` (no matches) -> `0`.
- `MAXIFS(A1:A5, B1:B5, ">=10", B1:B5, "<=20")` -> max within band.

## Open questions
- Whether error cells in `max_range` at non-matching positions are
  ignored (expected: yes, like `SUMIFS`).
- Empty `max_range` -> `0` vs `#VALUE!`.
