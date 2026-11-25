# LOGNORM.DIST

`LOGNORM.DIST(x, mean, standard_dev, cumulative)` — lognormal
distribution of `ln(x)` ~ Normal(`mean`, `standard_dev`). Excel 2010+;
legacy equivalent `LOGNORMDIST` (cumulative only).

## Arguments
- `x`: required; must be `> 0`, else `#NUM!`.
- `mean`: required; mean of `ln(x)` (any real).
- `standard_dev`: required; must be `> 0`, else `#NUM!`.
- `cumulative`: required boolean. `TRUE` -> CDF; `FALSE` -> PDF.
  Coerced per boolean rules (numeric `0`/`1` -> FALSE/TRUE — confirm).

## Semantics
- CDF: `LOGNORM.DIST(x, mu, sigma, TRUE) = NORM.S.DIST((ln(x)-mu)/sigma, TRUE)`.
- PDF: `= (1/(x*sigma*sqrt(2*pi))) * exp(-(ln(x)-mu)^2/(2*sigma^2))`.
- Non-numeric direct arguments -> `#VALUE!`.

## Errors
- `x <= 0` -> `#NUM!`; `standard_dev <= 0` -> `#NUM!`.
- Text non-coercible args -> `#VALUE!`. Error args propagate.

## Examples
- `LOGNORM.DIST(4, 3.5, 1.2, TRUE)` -> `0.039083555...` (documented
  Excel example result `0.0390836`).
- `LOGNORM.DIST(4, 3.5, 1.2, FALSE)` -> `0.017617596...` (Excel doc:
  `0.0176176`).
- `LOGNORM.DIST(1, 0, 1, TRUE)` -> `0.5` (median of standard lognormal).

## Open questions
- `cumulative` coercion for non-boolean scalars (numeric vs text).
- Tolerances vs Excel's internal approximation (reported ~7 digit
  agreement with the closed form).

## Engine requirements
- Requires numerically stable normal CDF (shared with `NORM.S.DIST`)
  and log/exp; no external deps.
