# CHOOSECOLS

`CHOOSECOLS(array, col_num1, [col_num2], ...)` — returns a new array
consisting of the selected columns of `array`, in the order given.
Dynamic-array function: result spills.

## Arguments
- `array`: required; range or array value.
- `col_numN`: required, 1..n indexes; integer column positions,
  1-based. Negative values count from the right edge (`-1` = last
  column). `0` or out-of-range -> `#VALUE!`.

## Semantics
- Column indexes may repeat (`CHOOSECOLS(A1:C3,2,2)` duplicates column
  B) and may be in any order.
- Result has the same number of rows as `array` and as many columns as
  there are `col_numN` arguments.
- Element values are passed through unchanged (errors inside selected
  columns propagate in place; errors in unselected columns do not).
- `col_numN` coercion: numeric scalars; fractional values truncated?
  (confirm — Excel truncates index args in most functions; **Open
  question**). Text numbers coerce; booleans coerce to 1/0 (0 ->
  `#VALUE!`).

## Errors
- Any `col_numN` = 0, > width, or < -width -> `#VALUE!`.
- Fewer than 2 arguments -> arity error (`#VALUE!` mapping **SPEC-OPEN**).
- Non-array first argument: a scalar is treated as a 1x1 array — only
  `col_num1=1` or `-1` is legal (confirm).

## Examples
- `CHOOSECOLS({1,2,3;4,5,6}, 1, 3)` -> `{1,3;4,6}`
- `CHOOSECOLS({1,2,3;4,5,6}, -1)` -> `{3;6}`
- `CHOOSECOLS({1,2,3;4,5,6}, 3, 1, 3)` -> `{3,1,3;6,4,6}`
- `CHOOSECOLS({1,2,3}, 4)` -> `#VALUE!`

## Compatibility notes
- Excel 365 (2022+, dynamic arrays). Not in Excel 2019 or earlier.
- Under a non-spilling engine, the result is still an `Array` value;
  only the *display* differs.

## Open questions
- Truncation of fractional column indexes.
- Whether `0` is `#VALUE!` vs `#CALC!` in current Excel builds.
