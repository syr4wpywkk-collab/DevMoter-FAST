# NORMDIST

`NORMDIST(x, mean, standard_dev, cumulative)` — normal distribution
PDF or CDF for the given mean and standard deviation.

Legacy compatibility function; modern equivalent is `NORM.DIST`
(identical signature).

## Arguments
- `x`: required scalar.
- `mean`: required distribution mean.
- `standard_dev`: required, `> 0`.
- `cumulative`: required boolean; `TRUE` -> `P(X <= x)`;
  `FALSE` -> density at `x`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- CDF: `NORMSDIST((x - mean)/standard_dev)`.
- PDF: `exp(-(x-mean)^2/(2*s^2)) / (s * sqrt(2*pi))`.

## Errors
- `standard_dev <= 0` -> `#NUM!`.
- Non-numeric `x`, `mean`, `standard_dev` -> `#VALUE!`.

## Engine requirements
- Standard normal CDF (erf-based); shared with `NORMSDIST`.

## Examples
- `NORMDIST(42, 40, 1.5, TRUE)` -> `0.908789` (Microsoft docs
  example)
- `NORMDIST(42, 40, 1.5, FALSE)` -> `0.1094400` (Microsoft docs
  example)
- `NORMDIST(40, 40, 1.5, TRUE)` -> `0.5`
- `NORMDIST(0, 0, -1, TRUE)` -> `#NUM!`

## Open questions
- Precision target vs Excel's CDF implementation — record in
  fixtures.
