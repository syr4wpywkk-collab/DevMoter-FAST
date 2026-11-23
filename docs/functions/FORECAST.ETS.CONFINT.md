# FORECAST.ETS.CONFINT

`FORECAST.ETS.CONFINT(target_date, values, timeline, [confidence_level], [seasonality], [data_completion], [aggregation])` — half-width
of the prediction interval around a `FORECAST.ETS` forecast.

## Arguments
- `target_date`, `values`, `timeline`: as `FORECAST.ETS`.
- `confidence_level`: optional; `0 < c < 1`, default `0.95`.
- `seasonality`, `data_completion`, `aggregation`: as `FORECAST.ETS`.

## Semantics
- Interval = `FORECAST.ETS(target_date,...) ± CONFINT(...)`. Width
  grows with |target_date - end of timeline| via the ETS variance
  model (not closed-form).

## Errors
- `confidence_level` outside `(0,1)` -> `#NUM!`.
- Same timeline/target errors as `FORECAST.ETS`.

## Examples
- `FORECAST.ETS.CONFINT(13,{1..12},{1..12})` — positive scalar;
  fixture must be recorded from Excel (**no closed form**).
- `FORECAST.ETS.CONFINT(13,{1,2,3,4},{1,2,3,4},0.9)` — record from
  Excel.
- `FORECAST.ETS.CONFINT(13,{1,2,3},{1,3,4})` -> `#NUM!`
- `FORECAST.ETS.CONFINT(13,{1,2,3},{1,2,3},1.5)` -> `#NUM!`

## Compatibility / Engine requirements / Open questions
- Same as `FORECAST.ETS` (Excel 2016+; full ETS machinery required;
  all numeric outputs must be captured from real Excel for fixtures).
