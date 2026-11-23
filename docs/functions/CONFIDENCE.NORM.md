# CONFIDENCE.NORM

`CONFIDENCE.NORM(alpha, standard_dev, size)` — half-width of the
confidence interval for a population mean using the normal
distribution: `NORM.S.INV(1 - alpha/2) * standard_dev / SQRT(size)`.

## Arguments
- `alpha`: significance level; `0 < alpha < 1` (confidence = 1-alpha).
- `standard_dev`: population standard deviation; must be `> 0`.
- `size`: sample size; `>= 1` (truncated to integer; documented
  requirement `size >= 1`).

## Errors
- `alpha <= 0` or `alpha >= 1` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- `size < 1` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `CONFIDENCE.NORM(0.05,2.5,50)` -> `0.6929519121748391` (z=1.959964,
  2.5/√50)
- `CONFIDENCE.NORM(0.01,1,100)` -> `0.2575829177366836` (z=2.575829,
  1/10)
- `CONFIDENCE.NORM(0.05,1,1)` -> `1.959963984540054`
- `CONFIDENCE.NORM(0,1,10)` -> `#NUM!`
- `CONFIDENCE.NORM(0.05,0,10)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CONFIDENCE` (identical signature/semantics).

## Engine requirements
- **Distribution numerics**: inverse standard normal `NORM.S.INV`
  (rational approximation / Acklam-style).

## Open questions
- Whether `size` truncates fractional values before the `< 1` check.
