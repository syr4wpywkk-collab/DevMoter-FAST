# PERCENTILE.INC

`PERCENTILE.INC(array, k)` — returns the k-th percentile (inclusive)
of the numeric values in `array`, using linear interpolation.

## Arguments
- `array`: non-numeric values ignored; errors propagate.
- `k`: number in `[0,1]` (fraction, not percent).

## Algorithm
- Sort the n numeric values ascending. Rank `r = k*(n-1)` (0-based).
- If `r` is an integer index, return that element; otherwise interpolate
  linearly between `floor(r)` and `ceil(r)`.
- `k=0` -> min, `k=1` -> max, `k=0.5` -> median (matches MEDIAN).

## Errors
- `#NUM!` when `k` outside `[0,1]` or the numeric set is empty.
- `#VALUE!` when `k` is not coercible to a number.

## Edge cases
- Single value: any `k` in `[0,1]` returns that value.
- `PERCENTILE.INC({1,2,3,4},0.75)` -> `3.25`.

## Open questions
- Exact floating-point interpolation ordering to match Excel bit-for-
  bit (or the accepted tolerance) — record in fixtures.
