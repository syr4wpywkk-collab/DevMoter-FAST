# CRITBINOM

`CRITBINOM(trials, probability_s, alpha)` — smallest integer `x`
such that the cumulative binomial distribution `P(X <= x) >= alpha`.

Legacy compatibility function; modern equivalent is `BINOM.INV`.

## Arguments
- `trials`: required; number of trials, truncated to integer.
- `probability_s`: required; success probability in `[0, 1]`.
- `alpha`: required; criterion value in `[0, 1]`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `CRITBINOM(n, p, a) = min{ x : BINOMDIST(x, n, p, TRUE) >= a }`.
- Result always in `[0, trials]`; `alpha = 1` returns `trials` —
  confirm (edge).

## Errors
- `trials < 0` -> `#NUM!`.
- `probability_s < 0` or `> 1` -> `#NUM!`.
- `alpha < 0` or `> 1` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Examples
- `CRITBINOM(6, 0.5, 0.75)` -> `4` (Microsoft docs example)
- `CRITBINOM(10, 0.5, 0.5)` -> `5` (CDF(4)=0.376953, CDF(5)=0.623047)
- `CRITBINOM(10, 0.5, 0)` -> `0` (min x with CDF >= 0 is 0 —
  confirm; CDF(0) > 0 so 0 qualifies)
- `CRITBINOM(-1, 0.5, 0.5)` -> `#NUM!`

## Open questions
- `alpha = 0` edge (expected `0`) — confirm.
- `alpha` exactly equal to a CDF step (floating-point `>=`
  boundary) — fixture with care.
