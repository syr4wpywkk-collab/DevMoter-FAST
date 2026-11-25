# HYPGEOM.DIST

`HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, cumulative)` — hypergeometric probability: drawing `sample_s` successes
in `number_sample` draws (without replacement) from a population of
`number_pop` containing `population_s` successes.

## Arguments
- `sample_s`: observed successes in sample; `0 <= k <= min(n, M)` and
  `k >= max(0, n - (N - M))` for nonzero probability — out-of-support
  values return `0`? or `#NUM!`: docs say `sample_s < 0` or
  `sample_s > min(n, M)` -> `#NUM!`; values below the lower support
  bound return `0` for CDF — **confirm** exact rules.
- `number_sample`: `0 < n <= N`.
- `population_s`: `0 <= M <= N`.
- `number_pop`: `N > 0`.
- `cumulative`: logical; `TRUE` -> `P(X <= k)`.
- All integer params truncated if non-integer.

## Semantics
- PMF `= C(M,k) C(N-M, n-k) / C(N,n)`.
- CDF: sum of PMF over `0..k`.

## Errors
- `sample_s < 0` or `> min(n, M)` -> `#NUM!`.
- `n > N` -> `#NUM!`; `M > N` or `M < 0` -> `#NUM!`; `N <= 0` ->
  `#NUM!` — bounds per docs; confirm each.
- Non-numeric args -> `#VALUE!`.

## Examples
- `HYPGEOM.DIST(1,4,8,20,FALSE)` -> `0.3632610939112487`
  (C(8,1)C(12,3)/C(20,4) = 1760/4845)
- `HYPGEOM.DIST(1,4,8,20,TRUE)` -> `0.4653897...` (P(X<=1); compute:
  P(0)=C(12,4)/C(20,4)=495/4845≈0.10217 + 0.36326 = 0.46543? compute
  exactly for fixture)
- `HYPGEOM.DIST(0,4,8,20,FALSE)` -> `0.102166...` (495/4845)
- `HYPGEOM.DIST(9,4,8,20,FALSE)` -> `#NUM!` (k > min(4,8)=4)
- `HYPGEOM.DIST(1,4,8,3,FALSE)` -> `#NUM!` (n > N)

## Compatibility
- Excel 2010+. Legacy `HYPGEOMDIST` — same but *no* `cumulative` arg
  (PMF only).

## Engine requirements
- Log-factorials (`GAMMALN`) or stable product form to avoid overflow
  for large N (Excel max N? — **confirm**, historically large).

## Open questions
- Lower-support-bound behavior (return `0` vs `#NUM!`).
- Exact parameter-bound error conditions.
