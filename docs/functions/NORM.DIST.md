# NORM.DIST

`NORM.DIST(x, mean, standard_dev, cumulative)` — normal distribution.
Excel 2010+; legacy `NORMDIST`.

## Arguments
- `x`: required; value at which to evaluate.
- `mean`: required; distribution mean.
- `standard_dev`: required; `> 0` else `#NUM!`.
- `cumulative`: required boolean; `TRUE` = CDF, `FALSE` = PDF.

## Semantics
- PDF: `(1/(sigma*sqrt(2*pi))) * exp(-((x-mu)^2)/(2*sigma^2))`.
- CDF: `0.5 * (1 + erf((x-mu)/(sigma*sqrt(2))))` — implementation may
  use erf or a rational approximation; Excel's own approximation limits
  accuracy to ~7-8 significant digits (documented KB note).
- `mean = 0`, `sigma = 1` reduces to `NORM.S.DIST`.
- Boolean/text coercion: numeric text scalars coerce; non-numeric
  -> `#VALUE!`.

## Errors
- `standard_dev <= 0` -> `#NUM!`.
- Non-numeric -> `#VALUE!`; errors propagate.

## Examples
- `NORM.DIST(42, 40, 1.5, TRUE)` -> `0.908788780...` (Excel doc:
  `0.908789`).
- `NORM.DIST(42, 40, 1.5, FALSE)` -> `0.109440049...` (Excel doc:
  `0.10934005`? — documented value `0.10944`; verify).
- `NORM.DIST(0, 0, 1, FALSE)` -> `0.39894228...` (1/sqrt(2*pi)).
- `NORM.DIST(1.96, 0, 1, TRUE)` -> `~0.9750021`.

## Open questions
- Which approximation Excel uses internally (affects last-digit
  fixtures); spec should record chosen algorithm + tolerance.
- `cumulative` coercion for non-boolean scalars.

## Engine requirements
- Needs erf (or equivalent normal-CDF routine) implemented in
  `calc-core` (no external crates) — flag precision budget.
