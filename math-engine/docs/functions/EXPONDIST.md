# EXPONDIST

`EXPONDIST(x, lambda, cumulative)` — exponential distribution:
probability density or cumulative probability.

Legacy compatibility function; modern equivalent is `EXPON.DIST`.

## Arguments
- `x`: required scalar, `>= 0`.
- `lambda`: required rate parameter, `> 0`.
- `cumulative`: required boolean; `TRUE` -> CDF
  `1 - e^(-lambda*x)`; `FALSE` -> PDF `lambda * e^(-lambda*x)`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Errors
- `x < 0` -> `#NUM!`.
- `lambda <= 0` -> `#NUM!`.
- Non-numeric `x`/`lambda` -> `#VALUE!`.

## Examples
- `EXPONDIST(0.2, 10, TRUE)` -> `0.8646647168` (`1 - e^-2`)
- `EXPONDIST(0.2, 10, FALSE)` -> `1.353352832` (`10 * e^-2`)
- `EXPONDIST(0, 10, TRUE)` -> `0`
- `EXPONDIST(-0.1, 10, TRUE)` -> `#NUM!`

## Open questions
- Overflow behavior for large `lambda * x` in the PDF branch
  (underflows to 0 — no error expected) — confirm.
