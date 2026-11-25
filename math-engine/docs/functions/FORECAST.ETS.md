# FORECAST.ETS

`FORECAST.ETS(target_date, values, timeline, [seasonality], [data_completion], [aggregation])` — exponential-triple-smoothing (ETS AAA)
point forecast for `target_date`.

## Arguments
- `target_date`: numeric date/serial to forecast; must be > last
  timeline point (within the supported horizon) — earlier targets ->
  `#NUM!`.
- `values`: historical numeric series (same length as `timeline`).
- `timeline`: numeric, strictly positive-step sequence (dates or
  numbers); must have *constant step* — irregular spacing -> `#NUM!`.
- `seasonality`: optional. `0`/omitted -> automatic detection
  (needs >= 2 full cycles else additive seasonality disabled);
  `1` -> auto-detect but force positive?? Documented: `1` means
  automatic detection with a forced... — **SPEC-OPEN**, exact
  encoding: `0`=no seasonality? Actually documented: omitted/`1` =
  auto, `0` = no seasonality, N>=2 = fixed period N. Confirm.
- `data_completion`: `0` = treat missing points as zero, `1` (default)
  = interpolate missing points linearly.
- `aggregation`: `1`-`7` = AVERAGE, COUNT, COUNTA, MAX, MEDIAN, MIN,
  SUM used to collapse duplicate timeline points. Default `1`.

## Errors
- `target_date` <= last timeline entry -> `#NUM!`.
- Non-constant timeline step -> `#NUM!`.
- `values`/`timeline` different lengths -> `#VALUE!` (**confirm** kind).
- Fewer than 3 points? Documented minimum history requirements —
  **confirm** (ETS needs at least 2-3 observations).
- Series identical values (zero variance) — Excel returns the constant
  or `#NUM!`? **confirm**.

## Engine requirements
- **Heavy numerics**: full ETS AAA state-space fit (Holt-Winters with
  additive error/trend/seasonality) plus Excel's specific parameter
  optimization (MSE-minimizing). Requires a dedicated implementation
  and numerical optimizer; f64 only. Also requires timeline
  step-detection and missing-point interpolation. **Flag: this is one
  of the most complex functions in the track — confirm scope before
  implementing.**

## Examples
- `FORECAST.ETS(13,{1,2,3,4,5,6,7,8,9,10,11,12},{1,2,3,4,5,6,7,8,9,10,11,12})`
  -> ≈`13` (linear trend, no seasonality — fixture must be verified
  against Excel since ETS output is not closed-form)
- Simple constant series `FORECAST.ETS(5,{7,7,7,7},{1,2,3,4})` ->
  expected `7` — **confirm**.
- `FORECAST.ETS(2,{1,2,3},{1,2,3})` (target not beyond end) ->
  `#NUM!`.
- `FORECAST.ETS(6,{1,2,3},{1,3,4})` (irregular steps) -> `#NUM!`.

## Compatibility
- Excel 2016+ only; `FORECAST.ETS.*` family does not exist in earlier
  versions or LibreOffice < 5.2.

## Open questions
- Exact ETS variant (AAA vs Excel's documented "AAA" with parameter
  bounds) and optimizer tolerance — fixtures must come from real
  Excel output.
- `seasonality` argument encoding details.
- `aggregation` applied to duplicate timestamps.
- Error kinds for length mismatch / insufficient history.
