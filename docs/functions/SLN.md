# SLN

`SLN(cost, salvage, life)` — straight-line depreciation per period.

## Arguments
- `cost`: required; initial asset cost.
- `salvage`: required; value at end of life.
- `life`: required; number of periods, must be nonzero.

## Semantics
- `SLN = (cost - salvage) / life`.
- Negative `life` produces a negative result in Excel? — Excel returns
  `#NUM!` for `life <= 0`? Confirm: docs say `life` must not be 0
  (`#DIV/0!`); negative life — verify.
- No truncation of args.

## Coercion
- Direct-scalar; errors propagate; non-coercible -> `#VALUE!`.

## Errors
- `life = 0` -> `#DIV/0!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `SLN(30000, 7500, 10)` -> `2250`.
- `SLN(1000, 1000, 5)` -> `0`.
- `SLN(5000, 500, 4)` -> `1125`.
- `SLN(1000, 100, 0)` -> `#DIV/0!`.

## Open questions
- Negative `life`: `#NUM!` vs negative result.
- Whether `salvage > cost` (appreciation) is allowed -> negative
  depreciation (expected yes, returns negative).
