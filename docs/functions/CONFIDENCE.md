# CONFIDENCE

`CONFIDENCE(alpha, standard_dev, size)` — confidence interval
half-width for a population mean using the normal distribution:
`NORMSINV(1 - alpha/2) * standard_dev / sqrt(size)`.

Legacy compatibility function; modern equivalent is
`CONFIDENCE.NORM`. Note: `CONFIDENCE.T` uses the t-distribution and
is a different function.

## Arguments
- `alpha`: required significance level in `(0, 1)`; confidence level
  is `1 - alpha`.
- `standard_dev`: required population standard deviation, `> 0`.
- `size`: required sample size; truncated to integer, `>= 1`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Errors
- `alpha <= 0` or `alpha >= 1` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- `size < 1` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Requires `NORMSINV` (inverse standard normal); see `NORMSINV.md`.

## Examples
- `CONFIDENCE(0.05, 2.5, 50)` -> `0.6929519` (Microsoft docs
  example)
- `CONFIDENCE(0.05, 1, 1)` -> `1.9599640` (`= NORMSINV(0.975)`)
- `CONFIDENCE(0.5, 1, 100)` -> `0.0674498` (`NORMSINV(0.75)/10`)
- `CONFIDENCE(0, 1, 10)` -> `#NUM!`

## Open questions
- `size` truncated before or after the `< 1` check (Excel truncates
  then checks — confirm e.g. `size = 0.9` -> `#NUM!`).
