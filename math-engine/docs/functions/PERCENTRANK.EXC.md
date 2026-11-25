# PERCENTRANK.EXC

`PERCENTRANK.EXC(array, x, [significance])` — rank of `x` within
`array` as an **exclusive** percentage `(rank)/(n+1)`. Excel 2010+.

## Arguments
- `array`: required range/array.
- `x`: required; value to rank.
- `significance`: optional; digits of precision (default `3`); `>= 1`
  else `#NUM!`. Fractional is truncated? (confirm — same as `.INC`).

## Semantics
- Let `r` = count of values `< x`, `n` = count of numeric values.
- If `x` matches an element: `PERCENTRANK.EXC = r/(n+1)`? — more
  precisely, position of the matched value in sorted order over `n+1`.
  With duplicates, Excel uses the *first* matching rank? — Open
  question (same as `.INC`, documented poorly).
- If `x` lies between values: linear interpolation between the
  surrounding percent ranks.
- `x` outside `[min, max]` (no bracketing values) -> `#N/A`.

## Errors
- `x` smaller than min or larger than max -> `#N/A`.
- `significance < 1` -> `#NUM!`.
- Empty array -> `#N/A`? (confirm; `.INC` gives `#N/A` for x not in
  range and presumably error for empty).
- Non-numeric `x`/`significance` -> `#VALUE!`? (confirm — `x` text
  likely `#N/A`).

## Examples
- `PERCENTRANK.EXC({1;2;3;4;5}, 3)` -> `0.5`.
- `PERCENTRANK.EXC({1;2;3;4;5}, 2.5)` -> `0.416` (3 sig digits;
  interpolated 5/12).
- `PERCENTRANK.EXC({1;2;3;4;5}, 1)` -> `1/(6) = 0.166`.
- `PERCENTRANK.EXC({1;2;3}, 99)` -> `#N/A`.

## Open questions
- Duplicate-value rank convention.
- Result precision: is the raw value returned or rounded to
  `significance` digits? (Excel truncates display to `significance` —
  verify whether it's rounding or truncation.)
