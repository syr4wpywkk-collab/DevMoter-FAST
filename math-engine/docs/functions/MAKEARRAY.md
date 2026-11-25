# MAKEARRAY

`MAKEARRAY(rows, columns, LAMBDA)` — returns a `rows` x `columns`
array by calling `LAMBDA(row_index, column_index)` for each cell.

## Arguments
- `rows`: required positive integer (truncated — confirm).
- `columns`: required positive integer.
- `LAMBDA`: required LAMBDA taking exactly two parameters; indices are
  **1-based**.

## Behavior
- `MAKEARRAY(3, 2, LAMBDA(r, c, r * c))` -> `{1,2;2,4;3,6}`.
- `MAKEARRAY(2, 3, LAMBDA(r, c, r + c))` -> `{2,3,4;3,4,5}`.
- Evaluation order row-major (observable via volatile functions —
  document deterministically).
- LAMBDA may return arrays: nested results produce a "higher-dim"
  spill that Excel reports as `#CALC!` — engine: error or flatten,
  **SPEC-OPEN**.

## Errors
- `rows`/`columns` < 1 -> `#CALC!`? (Excel: `#VALUE!` for invalid
  size — confirm kind).
- LAMBDA arity mismatch -> `#VALUE!`.
- Any element error: element-wise vs whole-call — **SPEC-OPEN**.
- Output size exceeding the engine array cap -> `#CALC!`/budget
  error (plan limits).

## Compatibility / engine requirements
- Excel 365 only. Requires LAMBDA and dynamic-array spill.
- Evaluation budget: rows*columns LAMBDA invocations.

## Open questions
- Exact error kind for invalid dims and for nested-array results.
- Element-wise vs whole-call error propagation.
