# FORECAST.ETS.STAT

`FORECAST.ETS.STAT(values, timeline, statistic_type, [seasonality], [data_completion], [aggregation])` — returns one of eight internal
parameters/statistics of the fitted ETS model.

## Arguments
- `values`, `timeline`: as `FORECAST.ETS`.
- `statistic_type`: required integer `1..8`:
  - `1` Alpha (level smoothing)
  - `2` Beta (trend smoothing)
  - `3` Gamma (seasonality smoothing)
  - `4` MASE (mean absolute scaled error)
  - `5` SMAPE
  - `6` MAE
  - `7` RMSE
  - `8` Detected step size of the timeline
- `seasonality`, `data_completion`, `aggregation`: as `FORECAST.ETS`.

## Errors
- `statistic_type` outside `1..8` -> `#NUM!` (**confirm kind** —
  `#NUM!` vs `#VALUE!`).
- Same timeline/values errors as `FORECAST.ETS`.

## Examples
- `FORECAST.ETS.STAT({1,2,3,4,5,6,7,8,9,10,11,12},{1..12},8)` -> `1`
  (step size) — verify in Excel.
- `FORECAST.ETS.STAT({...},{...},4)` -> MASE value; must be captured
  from real Excel (no closed form).
- `FORECAST.ETS.STAT({1,2,3},{1,2,3},9)` -> `#NUM!` or `#VALUE!` —
  verify.

## Compatibility / Engine requirements
- Excel 2016+; full ETS fit required — **heavy numerics**, fixtures
  from real Excel only.

## Open questions
- Error kind for bad `statistic_type`.
- Whether statistics match documented metric definitions (MASE etc.)
  — verify.
