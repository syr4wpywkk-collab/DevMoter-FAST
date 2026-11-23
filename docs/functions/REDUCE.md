# REDUCE

`REDUCE(initial_value, array, LAMBDA(accumulator, value))` — folds an
array to a single accumulated value.

## Arguments
- `initial_value`: starting accumulator.
- `array`: input; flattened row-major.
- `LAMBDA`: two-parameter function `(acc, v) -> new_acc`.

## Behavior
- `REDUCE(0,{1,2,3},LAMBDA(a,v,a+v))` -> `6`.
- Left fold, row-major scan order — deterministic for reproducibility.
- Empty array -> returns `initial_value` — see open questions (Excel
  scans by row only; empty arrays may not be legal inputs).

## Evaluation budget
- One LAMBDA invocation per element; counts toward the per-recalc step
  and depth budgets (plan §9). Nested REDUCE/MAP invocations multiply
  and are bounded by the same global budget.

## Errors
- `#VALUE!` for LAMBDA arity != 2.
- Errors produced inside the accumulator propagate out as the result
  (once acc is an error it may short-circuit — see open question).

## Spill semantics
- Scalar result (no spill) unless the accumulator is itself an array,
  in which case it spills.

## Open questions
- Whether an error inside one iteration short-circuits or must flow
  through remaining iterations (performance vs Excel parity).
- Empty-input behavior (`#CALC!` vs returning initial_value).
- Whether `scan_by_column`-style ordering options are needed (Excel
  REDUCE has none).
