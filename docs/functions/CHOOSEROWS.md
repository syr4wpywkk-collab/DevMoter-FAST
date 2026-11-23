# CHOOSEROWS

`CHOOSEROWS(array, row_num1, [row_num2], ...)` — returns a new array
consisting of the selected rows of `array`, in the order given.
Dynamic-array function: result spills vertically.

## Arguments
- `array`: required; range or array value.
- `row_numN`: required, 1..n indexes; integer row positions, 1-based.
  Negative values count from the bottom (`-1` = last row). `0` or
  out-of-range -> `#VALUE!`.

## Semantics
- Row indexes may repeat and may be in any order.
- Result has the same number of columns as `array` and as many rows as
  there are `row_numN` arguments.
- Errors inside selected rows propagate in place; errors in unselected
  rows do not.
- Index coercion identical to `CHOOSECOLS` (see `CHOOSECOLS.md`).

## Errors
- Any `row_numN` = 0, > height, or < -height -> `#VALUE!`.
- Fewer than 2 arguments -> arity error.

## Examples
- `CHOOSEROWS({1,2;3,4;5,6}, 1, 3)` -> `{1,2;5,6}`
- `CHOOSEROWS({1,2;3,4;5,6}, -1)` -> `{5,6}`
- `CHOOSEROWS({1,2;3,4;5,6}, 3, 1)` -> `{5,6;1,2}`
- `CHOOSEROWS({1,2;3,4}, 3)` -> `#VALUE!`

## Compatibility notes
- Excel 365 (2022+, dynamic arrays). Not in Excel 2019 or earlier.

## Open questions
- Truncation of fractional row indexes.
- Exact error for `0`/out-of-range on current Excel builds
  (`#VALUE!` vs `#CALC!`).
