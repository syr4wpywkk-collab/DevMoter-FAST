# GAMMA.DIST

`GAMMA.DIST(x, alpha, beta, cumulative)` — gamma distribution PDF or
CDF with shape `alpha`, scale `beta`.

## Arguments
- `x`: `>= 0`.
- `alpha`: `> 0` (note: Excel historically also allowed `alpha` >= 1
  only? Documented: `alpha <= 0` -> `#NUM!`; very large alpha may
  give wrong results — flag).
- `beta`: `> 0` scale parameter (`=1/λ`).
- `cumulative`: logical.

## Semantics
- PDF `= x^(a-1) e^(-x/b) / (b^a Γ(a))`.
- CDF `= P(a, x/b)` (regularized lower incomplete gamma) — same engine
  as `CHISQ.DIST` (χ² is gamma with a=df/2, b=2).

## Errors
- `x < 0` -> `#NUM!`; `alpha <= 0` or `beta <= 0` -> `#NUM!`;
  non-numeric -> `#VALUE!`.
- Documented: `alpha >= 1` required?? Legacy `GAMMADIST` returned
  `#NUM!` for `alpha < 1`? — **confirm** (docs: "if alpha < 1,
  GAMMA.DIST may return incorrect results" per KB; flag).

## Examples
- `GAMMA.DIST(10.00001131,9,2,FALSE)` -> `0.0326390137...` (textbook
  example — compute exactly)
- `GAMMA.DIST(10.00001131,9,2,TRUE)` -> `0.0680938620...` (same ref)
- `GAMMA.DIST(4,2,2,TRUE)` -> `0.5939941502901619` (P(2,2)=1-3e^-2)
- `GAMMA.DIST(-1,1,1,TRUE)` -> `#NUM!`
- `GAMMA.DIST(1,0,1,TRUE)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `GAMMADIST` (identical signature).

## Engine requirements
- **Distribution numerics**: regularized incomplete gamma + `GAMMALN`.

## Open questions
- `alpha < 1` correctness note.
- Overflow handling for large x/alpha.
