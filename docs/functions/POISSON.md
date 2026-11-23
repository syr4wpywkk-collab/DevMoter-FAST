# POISSON

`POISSON(x, mean, cumulative)` — Poisson distribution point
probability or cumulative probability.

Legacy compatibility function; modern equivalent is `POISSON.DIST`
(identical signature).

## Arguments
- `x`: required; number of events; truncated to integer.
- `mean`: required expected numeric value, `>= 0` (Excel requires
  `mean > 0`? — docs: `mean < 0` -> `#NUM!`; `mean = 0` -> returns
  1/0 depending on cumulative — confirm).
- `cumulative`: required boolean; `TRUE` -> `P(X <= x)`;
  `FALSE` -> `P(X = x)`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `FALSE`: `e^-mean * mean^x / x!`.
- `TRUE`: sum over `k = 0..x`.

## Errors
- `x < 0` or `mean < 0` -> `#NUM!`.
- Non-numeric `x`/`mean` -> `#VALUE!`.

## Engine requirements
- Log-space evaluation of `x!` for large `x`; document supported
  range.

## Examples
- `POISSON(2, 5, FALSE)` -> `0.084224` (Microsoft docs example)
- `POISSON(2, 5, TRUE)` -> `0.124652` (Microsoft docs example)
- `POISSON(0, 5, FALSE)` -> `0.006737947` (`e^-5`)
- `POISSON(-1, 5, FALSE)` -> `#NUM!`

## Open questions
- `mean = 0` boundary result — confirm.
