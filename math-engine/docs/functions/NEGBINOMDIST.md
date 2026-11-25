# NEGBINOMDIST

`NEGBINOMDIST(number_f, number_s, probability_s)` — negative
binomial distribution: probability of `number_f` failures before
the `number_s`-th success, each trial succeeding with
`probability_s`.

Legacy compatibility function; modern equivalent is
`NEGBINOM.DIST(x, r, p, FALSE)`. Legacy form has **no cumulative
argument** — always the point probability.

## Arguments
- `number_f`: required; number of failures; truncated.
- `number_s`: required; threshold number of successes; truncated.
- `probability_s`: required; success probability in `[0, 1]`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `P = C(number_f + number_s - 1, number_s - 1) * p^number_s *
  (1 - p)^number_f`.

## Errors
- `number_f < 0` or `number_s < 1` -> `#NUM!`.
- `probability_s < 0` or `> 1` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `NEGBINOMDIST(10, 5, 0.25)` -> `0.055049` (Microsoft docs
  example: `C(14,4) * 0.25^5 * 0.75^10`)
- `NEGBINOMDIST(0, 1, 0.5)` -> `0.5` (first trial succeeds)
- `NEGBINOMDIST(0, 5, 1)` -> `1` (`p=1`: all successes, zero
  failures certain — confirm; may be `#NUM!` edge per docs p<=1
  ok)
- `NEGBINOMDIST(-1, 5, 0.5)` -> `#NUM!`

## Open questions
- `probability_s = 0` with `number_f = 0` — `0^0` boundary; confirm
  Excel result.
