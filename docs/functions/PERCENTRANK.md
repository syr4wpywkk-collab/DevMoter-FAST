# PERCENTRANK

`PERCENTRANK(array, x, [significance])` — rank of `x` within
`array` as a percentage in `[0, 1]`; interpolates when `x` falls
between values.

Legacy compatibility function; modern equivalents are
`PERCENTRANK.INC` (identical) and `PERCENTRANK.EXC` (returns
`(rank)/(n+1)` scale — different result).

## Arguments
- `array`: required range/array of numeric values; non-numerics
  ignored; errors propagate.
- `x`: required scalar; value whose rank is sought.
- `significance`: optional integer (>= 1); number of significant
  digits of the returned fraction; default `3`. Truncated to
  integer.

## Semantics
- Sort ascending. If `x` equals an element, percent rank =
  `(count below) / (n - 1)`.
- If `x` lies between elements `a < x < b`, interpolate:
  `pr(x) = pr(a) + (x - a)/(b - a) * (pr(b) - pr(a))`.
- If `x` is outside the range (below min or above max) -> `#N/A`.
- Result rounded (truncated?) to `significance` significant digits
  — confirm rounding vs truncation (Excel docs say significance
  controls displayed precision; e.g. default shows x.xxx).

## Errors
- `x` not found / outside data range -> `#N/A`.
- Empty numeric array -> `#N/A` (confirm vs `#NUM!`).
- `significance < 1` -> `#NUM!`.

## Examples
- `PERCENTRANK({13,12,11,8,4,3,2,1,1,1}, 2, 3)` -> `0.333`
  (Microsoft docs example: 3 below, 6 above -> 3/9)
- `PERCENTRANK({1,2,3,4}, 2.5)` -> `0.5` (pr(2) = 1/3, pr(3) = 2/3;
  midpoint interpolation -> 0.5)
- `PERCENTRANK({1,2,3,4}, 5)` -> `#N/A`
- `PERCENTRANK({1,2,3,4}, 2, 0)` -> `#NUM!`

## Open questions
- Whether significance rounds or truncates the fraction.
- Duplicate values of `x` in array (uses first/lowest index?).
