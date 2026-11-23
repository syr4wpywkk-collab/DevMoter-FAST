# VDB

`VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])` —
variable declining-balance depreciation over a (possibly fractional)
period interval, optionally switching to straight-line when that is
larger.

## Arguments
- `cost`: required; initial cost.
- `salvage`: required; salvage value at end of `life`.
- `life`: required; total life in periods.
- `start_period`: required; start of the interval (0-based:
  depreciation accrued from `start_period` to `end_period`).
- `end_period`: required; end of the interval, `> start_period`.
- `factor`: optional, default `2` (double declining balance).
- `no_switch`: optional, default `FALSE`. `TRUE` = never switch to
  straight-line even when SLN would give more.

## Semantics
- DDB-style rate: `factor/life`; book value declines geometrically.
- With `no_switch=FALSE` Excel switches to straight-line depreciation
  on the remaining basis when SL exceeds the DDB amount — matching
  `DB`-family "switch" behavior (confirm the switch rule against
  `DDB` with `factor` generalized).
- Fractional periods allowed (unlike `SYD`/`DDB` period indexing):
  `VDB(...,0,1)` = year-1 depreciation; `VDB(...,0,0.5)` = first
  half-year.
- `life`, `factor` truncated? Fractional `life` accepted — confirm.

## Coercion
- Direct-scalar; errors propagate.

## Errors
- `life <= 0`, `factor <= 0`? , `start < 0`, `end <= start`,
  `end > life` -> `#NUM!` (verify each bound — Microsoft docs list:
  salvage<0, life<=0, start<0, end>life, start>end, factor<=0 ->
  `#NUM!`).
- Non-numeric -> `#VALUE!`.

## Examples
- `VDB(2400, 300, 10, 0, 1)` -> `480` (2400 * 0.2).
- `VDB(2400, 300, 10, 1, 2)` -> `384` ((2400-480)*0.2).
- `VDB(2400, 300, 10, 0, 0.5)` -> `240`.
- `VDB(2400, 300, 10, 0, 10)` -> `2100` (total = cost - salvage).
- `VDB(2400, 300, 10, 2, 1)` -> `#NUM!`.

## Edge cases
- Switch-to-SL timing differs by `factor` and remaining book value;
  fixtures near the switch point needed.

## Open questions
- Exact SL-switch criterion and period granularity.
- Whether `factor` may be any positive real (docs suggest yes) and
  whether `factor=1` reproduces SYB... simple declining balance.
