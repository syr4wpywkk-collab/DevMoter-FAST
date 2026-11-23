# FORECAST

`FORECAST(x, known_ys, known_xs)` — legacy name for linear-regression
prediction; identical to `FORECAST.LINEAR`. Returns `a + b*x` where
`b = COVARIANCE.P(y,x) / VAR.P(x)` and `a = ȳ - b*x̄`.

## Arguments
- `x`: numeric point to predict; non-numeric -> `#VALUE!`.
- `known_ys`, `known_xs`: equal-size ranges/arrays of numerics;
  mismatched size -> `#N/A`; empty or `VAR.P(x)=0` -> `#DIV/0!`.

## Coercion
- Only positions numeric in *both* arrays count (**confirm** pair-skip
  rules, same as `SLOPE`/`INTERCEPT`); text/logical/blank pairs are
  skipped.

## Examples
- `FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})` ->
  `10.607253086419761` (regression through the five points)
- `FORECAST(0,{1,2,3},{1,2,3})` -> `0` (exact line y=x-1+1: slope 1,
  intercept 0)
- `FORECAST(10,{2,4,6},{1,2,3})` -> `20`
- `FORECAST(5,{1,2},{1})` -> `#N/A`
- `FORECAST(5,{1,2,3},{7,7,7})` -> `#DIV/0!` (zero x-variance)

## Compatibility
- Legacy; kept for pre-2016 workbooks. Prefer `FORECAST.LINEAR`.

## Open questions
- Pair-skip rules for non-numeric cells (expected: same as `SLOPE`).
