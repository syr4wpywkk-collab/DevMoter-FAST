# MINIFS

`MINIFS(min_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)`
— minimum of `min_range` cells where *all* criteria pairs match.
Excel 2019+ / Microsoft 365. Mirror of `MAXIFS`.

## Arguments
- `min_range`: required range.
- `criteria_rangeN, criteriaN`: 1..126 pairs; dimensions must equal
  `min_range`, else `#VALUE!`.

## Criteria grammar
Same as `SUMIFS`/`MAXIFS` (see `SUMIFS.md`).

## Semantics & errors
- Positional AND; only numeric `min_range` cells participate.
- No matching numeric cells -> `0` (documented; NOT an error).
- Error cells at matching positions propagate.

## Examples
- `MINIFS(B1:B4, A1:A4, ">10")` with `A=11,5,12,9`, `B=4,2,3,8` -> `3`.
- `MINIFS(A1:A5, B1:B5, ">=10", B1:B5, "<=20")` -> min in band.
- `MINIFS(A1:A3, B1:B3, "zzz")` (no matches) -> `0`.

## Open questions
- Whether non-matching-position error cells are ignored (expected: yes).
- Text-containing `min_range` positions: ignored (expected).
