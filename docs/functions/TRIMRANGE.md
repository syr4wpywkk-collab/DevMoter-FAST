# TRIMRANGE

`TRIMRANGE(range, [trim_rows], [trim_cols])` — removes leading and/or
trailing empty rows and columns from a range. Dynamic-array function
(Excel 365, 2024); also exposed via the trim-ref operators `:.`, `.:`
and `.:` in reference syntax (e.g. `A1:.A100`).

## Arguments
- `range`: required; range/array.
- `trim_rows`: optional; `0` none, `1` leading, `2` trailing,
  `3` both (default).
- `trim_cols`: optional; same encoding; default `3`.

## Semantics
- "Empty" = blank cells (and possibly cells containing `""`?
  **SPEC-OPEN** — Excel treats `""` results as non-empty for trim
  purposes in current builds; verify).
- If trimming would remove everything, returns the single
  anchor/boundary cell? Excel returns `#CALC!` "empty array" or a 1x1
  blank — **SPEC-OPEN**.
- Reference form keeps working as a *reference* (usable inside `SUM`,
  `COUNT` etc.), not only as an array.

## Errors
- `trim_rows`/`trim_cols` outside 0–3 -> `#VALUE!` (confirm `#CALC!`
  possibility).
- All-empty input -> `#CALC!`? (open).

## Examples
- `A1:C5` with data only in `B2:C3`: `TRIMRANGE(A1:C5)` -> `B2:C3`
  (as values `{...}`) — leading row/col and trailing rows/cols dropped.
- `TRIMRANGE(A1:A10, 2)` -> drops only trailing blank rows, keeps
  leading blanks.
- `TRIMRANGE({0,0;0,5}, 3, 3)` -> `{0,0;0,5}`? — `0` is not blank, so
  nothing trims (confirm).
- `TRIMRANGE(A1:A1)` where `A1` blank -> 1x1 blank or `#CALC!` (open).

## Engine requirements
- In reference position the result must remain a reference (for
  `SUM(TRIMRANGE(...))` style usage and for `:.`/`.:`/`:` trim-ref
  operators in parsed references — parser support required).

## Compatibility notes
- Excel 365 (2024). Trim-ref operators `A1:.A10`, `A1.:A10`, `A1:A10.`
  are the infix syntax equivalents.

## Open questions
- Whether `""`/formula-blank cells count as empty.
- Result for fully-empty ranges.
- Interaction of trim-ref operators with unions/intersections.
