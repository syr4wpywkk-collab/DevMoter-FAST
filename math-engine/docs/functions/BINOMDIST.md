# BINOMDIST

`BINOMDIST(number_s, trials, probability_s, cumulative)` — binomial
probability (individual term or cumulative).

Legacy compatibility function; modern equivalent is `BINOM.DIST`.

## Arguments
- `number_s`: required; number of successes. Truncated to integer.
- `trials`: required; number of independent trials. Truncated to
  integer.
- `probability_s`: required; success probability per trial, `[0,1]`.
- `cumulative`: required boolean; `TRUE` -> `P(X <= number_s)`,
  `FALSE` -> `P(X = number_s)`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`. `cumulative` accepts booleans and numbers (0 = FALSE).

## Semantics
- `FALSE`: `C(trials, number_s) * p^number_s * (1-p)^(trials -
  number_s)`.
- `TRUE`: sum of the above for `k = 0..number_s`.

## Errors
- `number_s < 0` or `number_s > trials` -> `#NUM!`.
- `probability_s < 0` or `> 1` -> `#NUM!`.
- Non-numeric `number_s`, `trials`, `probability_s` -> `#VALUE!`.

## Engine requirements
- Log-space evaluation of `C(n,k)` recommended for large `trials` to
  avoid overflow; document the supported magnitude range.

## Examples
- `BINOMDIST(3, 10, 0.5, FALSE)` -> `0.1171875` (120/1024)
- `BINOMDIST(2, 10, 0.5, TRUE)` -> `0.0546875` (56/1024)
- `BINOMDIST(6, 10, 0.5, FALSE)` -> `0.205078125`
- `BINOMDIST(11, 10, 0.5, FALSE)` -> `#NUM!`

## Open questions
- Truncation vs rounding of fractional `number_s`/`trials` (Excel
  truncates — confirm in fixture).
