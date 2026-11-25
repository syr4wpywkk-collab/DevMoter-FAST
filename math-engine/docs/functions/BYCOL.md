# BYCOL

`BYCOL(array, LAMBDA)` — applies a LAMBDA to each *column* of `array`
and returns a single-row array of the per-column results.

## Arguments
- `array`: required 2-D range/array.
- `LAMBDA`: required LAMBDA taking exactly one parameter (the column
  vector); must return a single value per invocation.

## Behavior
- `BYCOL({1,2,3;4,5,6}, LAMBDA(c, SUM(c)))` -> `{5,7,9}` (1x3).
- Result has 1 row and `columns(array)` columns; element j =
  `LAMBDA(array[:,j])`.
- LAMBDA returning more than one value per column -> `#CALC!`
  (Excel: "array result was not expanded because it would overwrite")
  — confirm kind vs `#VALUE!`.

## Errors
- LAMBDA arity mismatch -> `#VALUE!`.
- Per-column invocation that yields an error: becomes that result
  element vs fails whole call — **SPEC-OPEN** (same question as MAP).
- Evaluation budget: one LAMBDA call per column (plan §9 limits).

## Compatibility / engine requirements
- Excel 365 only. Requires LAMBDA, dynamic-array spill, and the
  column-slice view of `ArrayValue`.

## Open questions
- Error kind for multi-value LAMBDA results.
- Element-wise vs whole-call failure for errors inside LAMBDA.
