# BINOM.DIST

`BINOM.DIST(number_s, trials, probability_s, cumulative)` — binomial
probability `P(X = k)` or cumulative `P(X <= k)`.

## Arguments
- `number_s`: successes; `0 <= k <= trials`. Non-integer -> truncated
  toward zero before use.
- `trials`: non-negative integer (truncated if non-integer).
- `probability_s`: `0 <= p <= 1`.
- `cumulative`: logical; `TRUE` -> `P(X <= k)`, `FALSE` -> `P(X = k)`.

## Semantics
- PMF: `C(n,k) p^k (1-p)^(n-k)`.
- CDF: `sum_{i=0}^{k} C(n,i) p^i (1-p)^(n-i)`; computable via the
  regularized incomplete beta `I_(1-p)(n-k, k+1)` for stability.

## Errors
- `k < 0` or `k > trials` (after truncation) -> `#NUM!`.
- `p < 0` or `p > 1` -> `#NUM!`.
- `trials < 0` -> `#NUM!` (**confirm** — undocumented edge).
- Non-numeric args -> `#VALUE!`.

## Examples
- `BINOM.DIST(6,10,0.5,FALSE)` -> `0.205078125`
- `BINOM.DIST(6,10,0.5,TRUE)` -> `0.828125`
- `BINOM.DIST(48,50,0.6,FALSE)` -> `0.0723337063...` (≈0.0723)
- `BINOM.DIST(11,10,0.5,FALSE)` -> `#NUM!`
- `BINOM.DIST(2,5,1.5,FALSE)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `BINOMDIST` (same signature; also truncates
  `number_s`/`trials`).

## Engine requirements
- **Distribution numerics**: log-factorials (`GAMMALN`) or stable
  recurrence; incomplete beta for CDF.

## Open questions
- Negative `trials` behavior.
- Whether truncation happens before or after range checks for
  fractional `k` near `trials` (e.g. `k=10.9, trials=10` -> truncated
  10, valid).
