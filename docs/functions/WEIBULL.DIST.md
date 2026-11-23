# WEIBULL.DIST

`WEIBULL.DIST(x, alpha, beta, cumulative)` — Weibull distribution.
Excel 2010+; legacy `WEIBULL`.

## Arguments
- `x`: required; `< 0` -> `#NUM!`.
- `alpha` (shape): required; `<= 0` -> `#NUM!`.
- `beta` (scale): required; `<= 0` -> `#NUM!`.
- `cumulative`: required boolean.

## Semantics
- CDF: `1 - exp(-(x/beta)^alpha)`; `x = 0` -> `0` (for alpha >= 1;
  alpha < 1, x=0 CDF is still 0 — but PDF diverges; `x=0, alpha<1,
  cumulative=FALSE` -> `Inf`/`#NUM!`? — Open question).
- PDF: `(alpha/beta) * (x/beta)^(alpha-1) * exp(-(x/beta)^alpha)`;
  `x = 0, alpha = 1` -> `1/beta` (exponential).
- Legacy `WEIBULL` is documented as returning the CDF only? — actually
  legacy `WEIBULL` also took `cumulative`; verify.

## Errors
- `x < 0`, `alpha <= 0`, `beta <= 0` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `WEIBULL.DIST(105, 20, 100, TRUE)` -> `0.929581390` (Excel doc
  example `0.929581`).
- `WEIBULL.DIST(105, 20, 100, FALSE)` -> `0.035588864` (doc
  `0.035589`).
- `WEIBULL.DIST(0, 1, 2, TRUE)` -> `0`.
- `WEIBULL.DIST(2, 1, 2, TRUE)` -> `1 - e^-1 = 0.632120559`
  (exponential case).

## Open questions
- `x = 0` with `alpha < 1` PDF (divergence -> error or Inf-clamp).
- Overflow of `(x/beta)^alpha` for extreme params -> `#NUM!`?
