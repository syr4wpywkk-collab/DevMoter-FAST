# FORECAST.ETS.SEASONALITY

`FORECAST.ETS.SEASONALITY(values, timeline, [data_completion], [aggregation])` — returns the detected seasonal period length (in
timeline units) that `FORECAST.ETS` would use.

## Arguments
- `values`, `timeline`: as `FORECAST.ETS` (same length, constant
  step).
- `data_completion`, `aggregation`: as `FORECAST.ETS`.

## Semantics
- Returns a non-negative number: `0` when no seasonality detected;
  otherwise the period length (count of steps per cycle, expressed in
  timeline units — **confirm** whether the return is a step count or
  a timeline-range).
- Requires >= 2 full cycles of data to detect seasonality; otherwise
  `0`? or `#NUM!` — **confirm**.

## Errors
- Timeline irregularity / length mismatch: same as `FORECAST.ETS`
  (`#NUM!` / `#VALUE!` — confirm kinds).

## Examples
- `FORECAST.ETS.SEASONALITY({1,2,1,2,1,2,1,2},{1,2,3,4,5,6,7,8})` ->
  expected `2` — **must be verified in Excel**.
- `FORECAST.ETS.SEASONALITY({1,2,3,4},{1,2,3,4})` -> `0` or `#NUM!`
  (insufficient cycles) — verify.
- `FORECAST.ETS.SEASONALITY({1,2,3},{1,3,4})` -> `#NUM!`

## Compatibility / Engine requirements
- Excel 2016+; depends on the same ETS seasonality-detection
  algorithm as `FORECAST.ETS` — **heavy numerics**, flag scope.

## Open questions
- Return units (steps vs timeline distance).
- Insufficient-data behavior.
