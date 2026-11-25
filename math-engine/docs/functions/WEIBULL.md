# WEIBULL

`WEIBULL(x, alpha, beta, cumulative)` — Weibull distribution PDF
or CDF.

Legacy compatibility function; modern equivalent is
`WEIBULL.DIST` (identical signature).

## Arguments
- `x`: required scalar, `>= 0`.
- `alpha`: required shape parameter, `> 0`.
- `beta`: required scale parameter, `> 0`.
- `cumulative`: required boolean.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- CDF: `1 - exp(-(x/beta)^alpha)`.
- PDF: `(alpha/beta^alpha) * x^(alpha-1) * exp(-(x/beta)^alpha)`.
- `alpha = 1` reduces to exponential with `lambda = 1/beta`.

## Errors
- `x < 0`, `alpha <= 0`, `beta <= 0` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `WEIBULL(105, 20, 100, TRUE)` -> `0.929581` (Microsoft docs
  example)
- `WEIBULL(105, 20, 100, FALSE)` -> `0.035589` (Microsoft docs
  example)
- `WEIBULL(100, 1, 100, TRUE)` -> `0.632120559` (`1 - e^-1`)
- `WEIBULL(-1, 20, 100, TRUE)` -> `#NUM!`

## Open questions
- `x = 0` with `alpha < 1` in the PDF branch (`x^(a-1)` -> inf) —
  Excel result? Flag for fixture.
