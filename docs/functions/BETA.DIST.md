# BETA.DIST

`BETA.DIST(x, alpha, beta, cumulative, [A], [B])` — beta probability
density or cumulative distribution, optionally over interval `[A,B]`
instead of `[0,1]`.

## Arguments
- `x`: value at which to evaluate; must satisfy `A <= x <= B`.
- `alpha`, `beta`: shape parameters; both must be `> 0`.
- `cumulative`: logical; `TRUE` -> CDF, `FALSE` -> PDF.
- `A`, `B`: optional lower/upper bounds of `x`; defaults `0` and `1`.
  If omitted, standard beta on `[0,1]`. Internally `x` is rescaled to
  `(x - A) / (B - A)` — **confirm** whether density is rescaled or
  Excel simply evaluates standard CDF on the rescaled argument
  (documented: Excel uses the standardized value).

## Coercion
- Non-numeric scalar arguments -> `#VALUE!`; booleans coerced
  `TRUE`/`FALSE` -> `1`/`0` (except `cumulative`, read as logical).
- `alpha`, `beta`, `A`, `B`, `x` truncated vs used as-is: used as-is
  (real-valued) except documented truncation does not apply.

## Errors
- `alpha <= 0` or `beta <= 0` -> `#NUM!`.
- `x < A`, `x > B`, or `A = B` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `BETA.DIST(0.5,2,3,TRUE)` -> `0.6875`
- `BETA.DIST(0.5,2,3,FALSE)` -> `1.5`  (pdf = 12 x(1-x)^2 at 0.5)
- `BETA.DIST(2,8,10,TRUE,1,3)` -> `0.6854705810117458`
- `BETA.DIST(0.5,0,1,TRUE)` -> `#NUM!`
- `BETA.DIST(1.5,1,1,TRUE,0,1)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy equivalent `BETADIST` (no `cumulative` split? —
  `BETADIST` returns CDF only, plus `A`,`B` args; `BETAINV` for
  inverse).

## Engine requirements
- **Distribution numerics**: requires the regularized incomplete beta
  function `I_x(a,b)` (continued fraction, e.g. Numerical Recipes
  `betai`) and `ln Γ` — must be implemented without external crates.

## Open questions
- Density rescaling when `A`,`B` supplied.
- Exact tolerance of `I_x` implementation vs Excel's (fixture eps).
