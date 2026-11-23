# WRAPROWS

`WRAPROWS(vector, wrap_count, [pad_with])` — reshapes a 1-D vector
into a 2-D array by filling **across rows**, starting a new row every
`wrap_count` elements. Dynamic-array function.

## Arguments
- `vector`: required; single row or column.
- `wrap_count`: required; positive integer — elements per row.
- `pad_with`: optional; fill value for the ragged tail. Default `#N/A`.

## Semantics
- Element i goes to `result[i div wrap_count][i mod wrap_count]`.
- Result has `ceil(len/wrap_count)` rows and `wrap_count` columns.
- Mirrors `WRAPCOLS` with transposed fill order.

## Errors
- `wrap_count` <= 0 or non-numeric -> `#VALUE!`.
- 2-D `vector` -> `#VALUE!` (confirm).

## Examples
- `WRAPROWS({1,2,3,4,5}, 2)` -> `{1,2;3,4;5,#N/A}`
- `WRAPROWS({1;2;3;4;5;6}, 3)` -> `{1,2,3;4,5,6}`
- `WRAPROWS({1,2,3,4,5}, 2, 0)` -> `{1,2;3,4;5,0}`
- `WRAPROWS({1,2}, -1)` -> `#VALUE!`

## Compatibility notes
- Excel 365 (2023+). Not in perpetual-license Excel.

## Open questions
- 2-D input handling (error vs flatten).
- `pad_with` array input behavior.
