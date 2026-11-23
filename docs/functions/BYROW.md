# BYROW

`BYROW(array, LAMBDA)` — applies a LAMBDA to each *row* of `array` and
returns a single-column array of the per-row results.

## Arguments
- `array`: required 2-D range/array.
- `LAMBDA`: required LAMBDA taking exactly one parameter (the row
  vector); must return a single value per invocation.

## Behavior
- `BYROW({1,2,3;4,5,6}, LAMBDA(r, SUM(r)))` -> `{6;15}` (2x1).
- Result has `rows(array)` rows and 1 column; element i =
  `LAMBDA(array[i,:])`.
- Multi-value LAMBDA results -> `#CALC!` (confirm — see BYCOL).

## Errors
- LAMBDA arity mismatch -> `#VALUE!`.
- Error inside a row's LAMBDA: element-wise vs whole-call —
  **SPEC-OPEN**.
- Evaluation budget: one LAMBDA call per row.

## Compatibility / engine requirements
- Excel 365 only. Requires LAMBDA, dynamic-array spill, row-slice
  views.

## Open questions
- Error kind for multi-value LAMBDA results.
- Element-wise vs whole-call error propagation.
