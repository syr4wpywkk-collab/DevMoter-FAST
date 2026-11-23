# WRAPCOLS

`WRAPCOLS(vector, wrap_count, [pad_with])` — reshapes a 1-D vector
into a 2-D array by filling **down columns**, starting a new column
every `wrap_count` elements. Dynamic-array function.

## Arguments
- `vector`: required; single row or column (or any array — Excel
  flattens row-major? confirm; documented input is a vector).
- `wrap_count`: required; positive integer — elements per column.
- `pad_with`: optional; fill value for the ragged tail. Default `#N/A`.

## Semantics
- Reads `vector` in order; element i goes to
  `result[i mod wrap_count][i div wrap_count]`.
- Result has `wrap_count` rows and `ceil(len/wrap_count)` columns.
- If `vector` is a 2-D array, Excel errors? or flattens — confirm;
  documented contract is a vector (`#VALUE!` believed for 2-D input).

## Errors
- `wrap_count` <= 0 or non-numeric -> `#VALUE!`.
- `wrap_count` > length with a 2-D `vector` -> `#VALUE!`? (for vector
  input it just yields one column).
- 2-D `vector` -> `#VALUE!` (confirm).

## Examples
- `WRAPCOLS({1,2,3,4,5}, 2)` -> `{1,3,5;2,4,#N/A}`
- `WRAPCOLS({1;2;3;4;5;6}, 3)` -> `{1,4;2,5;3,6}`
- `WRAPCOLS({1,2,3,4,5}, 2, 0)` -> `{1,3,5;2,4,0}`
- `WRAPCOLS({1,2}, 0)` -> `#VALUE!`

## Compatibility notes
- Excel 365 (2023+). Not in perpetual-license Excel.

## Open questions
- 2-D input handling (error vs flatten).
- `pad_with` array input behavior.
