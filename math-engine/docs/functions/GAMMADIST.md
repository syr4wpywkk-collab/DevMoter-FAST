# GAMMADIST

`GAMMADIST(x, alpha, beta, cumulative)` — gamma distribution: PDF
or CDF.

Legacy compatibility function; modern equivalent is `GAMMA.DIST`.

## Arguments
- `x`: required scalar, `>= 0`.
- `alpha`: required shape parameter, `> 0`.
- `beta`: required scale parameter, `> 0`.
- `cumulative`: required boolean; `TRUE` -> CDF, `FALSE` -> PDF.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- PDF: `x^(alpha-1) * e^(-x/beta) / (beta^alpha * Gamma(alpha))`.
- CDF: regularized lower incomplete gamma `P(alpha, x/beta)`.
- `alpha = 1` reduces to the exponential distribution with
  `lambda = 1/beta`.

## Errors
- `x < 0`, `alpha <= 0`, or `beta <= 0` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Gamma function and regularized incomplete gamma; std-only.

## Examples
- `GAMMADIST(10, 9, 2, FALSE)` -> `0.032639` (Microsoft docs
  example)
- `GAMMADIST(10, 9, 2, TRUE)` -> `0.068094` (Microsoft docs
  example)
- `GAMMADIST(1, 1, 1, TRUE)` -> `0.632120559` (`1 - e^-1`)
- `GAMMADIST(-1, 9, 2, TRUE)` -> `#NUM!`

## Open questions
- Precision targets and overflow behavior for large `alpha` —
  record in fixtures.
