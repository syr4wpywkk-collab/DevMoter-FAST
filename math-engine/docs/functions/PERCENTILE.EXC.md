# PERCENTILE.EXC

`PERCENTILE.EXC(array, k)` — k-th percentile using the **exclusive**
method. Excel 2010+; contrast `PERCENTILE.INC` (legacy `PERCENTILE`).

## Arguments
- `array`: required range/array of data.
- `k`: required; `0 < k < 1` strictly (unlike `.INC` which allows
  `0 <= k <= 1`).

## Semantics (exclusive method)
- Sort the `n` numeric values ascending as `x_(1)..x_(n)`.
- Rank position: `h = k*(n+1)`. Result =
  `x_(floor(h)) + frac(h)*(x_(ceil(h)) - x_(floor(h)))` (linear
  interpolation).
- If `k <= 1/(n+1)` or `k >= n/(n+1)` -> `#NUM!` (rank out of range).
- Coercion identical to `PERCENTILE.INC`/other aggregates: range
  text/boolean/blank ignored; error cells propagate; non-numeric `k`
  -> `#VALUE!`.

## Errors
- `k <= 0` or `k >= 1` -> `#NUM!`.
- `k` mapping outside `[1/(n+1), n/(n+1))` bounds -> `#NUM!`.
- Empty array / no numeric values -> `#NUM!`.
- Non-numeric `k` -> `#VALUE!`.

## Examples
- `PERCENTILE.EXC({1;2;3;4;5}, 0.5)` -> `3`.
- `PERCENTILE.EXC({1;2;3;4}, 0.5)` -> `2.5` (h = 2.5).
- `PERCENTILE.EXC({1;2;3;4}, 0.9)` -> `#NUM!` (h = 4.5 > 4).
- `PERCENTILE.EXC({1;2;3;4}, 0.2)` -> `1` (h = 1 exactly).

## Open questions
- Whether boundary `h` exactly at index 0 or n+1 errors (docs say
  `#NUM!` when `k < 1/(n+1)` or `k > n/(n+1)` — equality at `n/(n+1)`
  returns the max; verify).
