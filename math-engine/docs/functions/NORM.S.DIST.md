# NORM.S.DIST

`NORM.S.DIST(z, cumulative)` — standard normal distribution (mean 0,
sd 1). Excel 2010+; legacy `NORMSDIST`/`NORMSINV` pair.

## Arguments
- `z`: required; the z-value.
- `cumulative`: required boolean; `TRUE` = CDF, `FALSE` = PDF.

## Semantics
- PDF: `exp(-z^2/2)/sqrt(2*pi)`.
- CDF: `0.5*(1 + erf(z/sqrt(2)))`, or equivalent approximation.
- `NORM.S.DIST(0, TRUE) = 0.5` exactly (symmetry — enforce).

## Errors
- Non-numeric `z` -> `#VALUE!`.
- No domain restrictions on `z`; extreme `|z|` underflows CDF to `0`
  or `1` — document saturation behavior.

## Examples
- `NORM.S.DIST(1.333333, TRUE)` -> `0.908788726...` (Excel doc:
  `0.908789`).
- `NORM.S.DIST(1.333333, FALSE)` -> `0.164010149...`? (verify vs doc
  `0.164010148`). Record final value from fixture run.
- `NORM.S.DIST(0, FALSE)` -> `0.39894228`.
- `NORM.S.DIST(-1.96, TRUE)` -> `~0.0249979`.

## Open questions
- Internal approximation choice (polynomial/erf) and fixture
  tolerance vs Excel's ~1e-7 absolute.
- Saturation points for extreme z.

## Engine requirements
- erf/normal-CDF implementation in `calc-core`, no external crates.
