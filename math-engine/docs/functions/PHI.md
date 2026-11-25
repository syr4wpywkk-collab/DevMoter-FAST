# PHI

`PHI(x)` — standard normal **density** `exp(-x^2/2)/sqrt(2*pi)`.
Excel 2013+. Equivalent to `NORM.S.DIST(x, FALSE)` — note the name is
misleading: PHI returns the PDF, not the CDF.

## Arguments
- `x`: required; any real.

## Semantics
- `PHI(0) = 1/sqrt(2*pi) = 0.39894228...`.
- Symmetric: `PHI(-x) = PHI(x)`.
- Underflows to `0` for `|x|` > ~38 (document saturation).

## Errors
- Non-numeric -> `#VALUE!`.

## Examples
- `PHI(0)` -> `0.398942280...`.
- `PHI(0.75)` -> `0.301137432...` (Excel doc example `0.301137`).
- `PHI(-1)` -> `0.241970725`.

## Open questions
- None beyond the shared normal-PDF implementation tolerance
  (see `NORM.S.DIST`).

## Engine requirements
- Shared normal-PDF routine (std only).
