# FDIST

`FDIST(x, deg_freedom1, deg_freedom2)` — right-tailed F probability:
`P(X >= x)` where `X ~ F(v1, v2)`.

Legacy compatibility function; modern equivalent is `F.DIST.RT`.
`F.DIST` provides left-tailed CDF and PDF.

## Arguments
- `x`: required scalar, `>= 0`.
- `deg_freedom1`, `deg_freedom2`: required; truncated to integers.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `FDIST(x, v1, v2) = 1 - I_{v1*x/(v1*x + v2)}(v1/2, v2/2)` where
  `I` is the regularized incomplete beta function.

## Errors
- `x < 0` -> `#NUM!`.
- `deg_freedom1 < 1` or `>= 10^10`, same for `deg_freedom2` ->
  `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Regularized incomplete beta function (shared with `BETADIST`).

## Examples
- `FDIST(15.20686486, 6, 4)` -> `0.01` (Microsoft docs example)
- `FDIST(4, 2, 5)` -> `0.100438` (approx)
- `FDIST(0, 5, 5)` -> `1`
- `FDIST(-1, 5, 5)` -> `#NUM!`

## Open questions
- Precision target vs Excel — record in fixtures.
