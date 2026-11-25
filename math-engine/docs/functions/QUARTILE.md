# QUARTILE

`QUARTILE(array, quart)` — quartile of the numeric values in
`array` (inclusive method).

Legacy compatibility function; modern equivalent is
`QUARTILE.INC` (identical). `QUARTILE.EXC` differs.

## Arguments
- `array`: required range/array; non-numerics ignored; errors
  propagate.
- `quart`: required integer in `{0,1,2,3,4}`: 0 = min, 1 = Q1
  (25th), 2 = median (50th), 3 = Q3 (75th), 4 = max. Truncated
  to integer.

## Coercion
- Same as `PERCENTILE` for both arguments. `QUARTILE(a, q) =
  PERCENTILE(a, q/4)`.

## Errors
- `quart < 0` or `quart > 4` -> `#NUM!`.
- Empty numeric set -> `#NUM!`.
- Non-coercible `quart` -> `#VALUE!`.

## Examples
- `QUARTILE({1,2,4,7,8,9,10,12}, 1)` -> `3.5` (Microsoft docs
  example)
- `QUARTILE({1,2,4,7,8,9,10,12}, 2)` -> `7.5` (median of 8 items:
  avg of 4th & 5th -> (7+8)/2)
- `QUARTILE({1,2,4,7,8,9,10,12}, 0)` -> `1`; `(...,4)` -> `12`
- `QUARTILE({1,2,3}, 5)` -> `#NUM!`

## Open questions
- Same interpolation-precision question as `PERCENTILE.INC`.
