# BESSELI

`BESSELI(x, n)` — returns the modified Bessel function of the first kind,
I_n(x).

## Arguments
- `x`: required numeric; the value at which to evaluate the function.
- `n`: required numeric; the order of the Bessel function. Non-integer
  `n` is truncated to an integer (documented Excel behavior).

## Semantics
- Returns a scalar number.
- `n` is truncated toward zero before evaluation
  (`BESSELI(1.5, 1.9)` uses order `1`).
- Mathematically `I_n(x) = i^{-n} J_n(ix)`; Excel computes it via the
  standard series/asymptotic approximations. Result is real for real
  `x` and integer `n >= 0`.

## Coercion
- Text/blank/boolean arguments: numbers stored as text are coerced;
  non-numeric text -> `#VALUE!`. Blank -> `0` (confirm).

## Errors
- Non-numeric `x` or `n` -> `#VALUE!`.
- `n < 0` -> `#NUM!`.
- Result overflow (large `x`, `I_n` grows like `e^x`) -> `#NUM!`
  (confirm exact threshold — Excel returns `#NUM!` when the value
  exceeds representable range).

## Examples
- `BESSELI(1.5, 1)` = `1.646723189` (approx `1.6467231907`)
- `BESSELI(0, 0)` = `1`
- `BESSELI(2, 0)` = `2.279585302` (approx `2.2795853049`)
- `BESSELI(1.5, -1)` -> `#NUM!`

## Compatibility notes
- Available since Excel 2003 (Analysis ToolPak in earlier versions).
- Precision differs slightly between Excel releases (Excel 2010+
  improved algorithms vs the ATP versions).

## Engine requirements
- Requires a Bessel-function numeric implementation in std (no external
  crates allowed in calc-core). Needs series + asymptotic expansion with
  documented accuracy target (recommend ~15 significant digits, matching
  Excel 2010+).

## Open questions
- Exact `#NUM!` overflow threshold for large `x`.
- Whether negative `x` with integer `n` matches `I_n(-x) = (-1)^n I_n(x)`
  (expected yes — confirm).
- Blank `n` -> `0` (confirm).
