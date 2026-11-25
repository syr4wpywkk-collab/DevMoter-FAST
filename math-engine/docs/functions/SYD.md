# SYD

`SYD(cost, salvage, life, per)` — sum-of-years'-digits depreciation
for period `per`.

## Arguments
- `cost`: required; initial cost.
- `salvage`: required; salvage value.
- `life`: required; total life in periods.
- `per`: required; the period, `1 <= per <= life`.

## Semantics
- `SYD = (cost - salvage) * (life - per + 1) * 2 / (life * (life + 1))`.
- Depreciation is front-loaded; period 1 gets the largest charge.
- `per`/`life` truncation of fractional args — confirm (Excel likely
  truncates to integer, like DB/DDB).

## Coercion
- Direct-scalar; errors propagate.

## Errors
- `life <= 0` -> `#NUM!`.
- `per < 1` or `per > life` -> `#NUM!`? Confirm — some sources say
  Excel returns `#NUM!` when `per > life`; verify.
- Non-numeric -> `#VALUE!`.

## Examples
- `SYD(30000, 7500, 10, 1)` -> `4090.909090...` (22500 * 10/55).
- `SYD(30000, 7500, 10, 10)` -> `409.090909...` (22500 * 1/55).
- `SYD(10000, 0, 4, 2)` -> `3000` (10000 * 3/10).
- `SYD(10000, 0, 4, 5)` -> `#NUM!` (per > life — confirm).

## Open questions
- `per > life` error vs 0.
- Fractional `per`/`life` handling (truncate like `DB`? — `DB`
  truncates).
