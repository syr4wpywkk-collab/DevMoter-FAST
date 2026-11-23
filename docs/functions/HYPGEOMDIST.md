# HYPGEOMDIST

`HYPGEOMDIST(sample_s, number_sample, population_s, number_pop)` —
hypergeometric distribution: probability of exactly `sample_s`
successes in a sample of `number_sample` drawn without replacement
from a population of `number_pop` containing `population_s`
successes.

Legacy compatibility function; modern equivalent is
`HYPGEOM.DIST(x, n, M, N, FALSE)`. The legacy form has **no
cumulative argument** — always the point probability.

## Arguments
- `sample_s`: required; successes in the sample; truncated.
- `number_sample`: required; sample size; truncated.
- `population_s`: required; successes in the population; truncated.
- `number_pop`: required; population size; truncated.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `P = C(population_s, sample_s) * C(number_pop - population_s,
  number_sample - sample_s) / C(number_pop, number_sample)`.

## Errors
- `sample_s < 0`, `sample_s > min(number_sample, population_s)`, or
  `sample_s < max(0, number_sample - number_pop + population_s)` ->
  `#NUM!`.
- `number_sample <= 0` or `> number_pop` -> `#NUM!`.
- `population_s <= 0` or `> number_pop` -> `#NUM!`.
- `number_pop <= 0` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `HYPGEOMDIST(1, 4, 8, 20)` -> `0.363261` (Microsoft docs example:
  `8*C(12,3)/C(20,4) = 1760/4845`)
- `HYPGEOMDIST(0, 4, 8, 20)` -> `0.102253` (`C(12,4)/C(20,4) =
  495/4845`)
- `HYPGEOMDIST(5, 4, 8, 20)` -> `#NUM!` (sample_s > number_sample)
- `HYPGEOMDIST(1, 4, 8, -20)` -> `#NUM!`

## Open questions
- Binomial-coefficient overflow strategy for large populations —
  engine numerics note; confirm supported range.
