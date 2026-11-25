# LOGNORMDIST

`LOGNORMDIST(x, mean, standard_dev)` — cumulative lognormal
distribution of `x`, where `ln(x)` is normally distributed with the
given mean and standard deviation.

Legacy compatibility function; modern equivalents are
`LOGNORM.DIST(x, mean, sd, TRUE)` and `LOGNORM.DIST(..., FALSE)` for
the PDF. Legacy form is always cumulative.

## Arguments
- `x`: required scalar, `> 0`.
- `mean`: required mean of `ln(x)`.
- `standard_dev`: required std dev of `ln(x)`, `> 0`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `LOGNORMDIST(x, m, s) = NORMSDIST((ln(x) - m) / s)`.

## Errors
- `x <= 0` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `LOGNORMDIST(4, 3.5, 1.2)` -> `0.039084` (Microsoft docs example)
- `LOGNORMDIST(1, 0, 1)` -> `0.5` (`ln 1 = 0` -> median)
- `LOGNORMDIST(33.11545196, 3.5, 1.2)` -> `0.5`
- `LOGNORMDIST(0, 3.5, 1.2)` -> `#NUM!`

## Open questions
- None identified beyond shared `NORMSDIST` precision (see
  `NORMSDIST.md`).
