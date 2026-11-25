# CHIDIST

`CHIDIST(x, deg_freedom)` — right-tailed (upper-tail) probability of
the chi-squared distribution: `P(X >= x)`.

Legacy compatibility function; modern equivalents are
`CHISQ.DIST.RT` (identical) and `CHISQ.DIST(x, df, FALSE/TRUE)` for
left-tailed/density forms.

## Arguments
- `x`: required scalar; point at which to evaluate.
- `deg_freedom`: required; degrees of freedom, truncated to integer.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `CHIDIST(x, v) = 1 - P(v/2, x/2)` where `P` is the regularized
  lower incomplete gamma function.

## Errors
- `x < 0` -> `#NUM!`.
- `deg_freedom < 1` or `deg_freedom >= 10^10` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Regularized incomplete gamma function; std-only numerics in
  calc-core.

## Examples
- `CHIDIST(18.307, 10)` -> `0.0500006` (approx; Excel docs example)
- `CHIDIST(5.991464547107979, 2)` -> `0.05`
- `CHIDIST(0, 5)` -> `1`
- `CHIDIST(-1, 2)` -> `#NUM!`

## Open questions
- Precision target vs Excel's implementation — record in fixtures.
