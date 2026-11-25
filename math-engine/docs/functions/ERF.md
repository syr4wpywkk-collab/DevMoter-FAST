# ERF

`ERF(lower_limit, [upper_limit])` — returns the error function
(Gauss error function) integrated between limits.

## Arguments
- `lower_limit`: required numeric; lower integration bound.
- `upper_limit`: optional numeric; if omitted, integrates `0` to
  `lower_limit` (i.e. returns `erf(lower_limit)`).

## Semantics
- With both args: returns `erf(upper) - erf(lower)` =
  `2/sqrt(pi) * integral_{lower}^{upper} e^{-t^2} dt`.
- `erf` is odd: `erf(-x) = -erf(x)`. Range `(-1, 1)`;
  `erf(+/-inf) = +/-1`.
- Scalar result.

## Coercion
- Non-numeric arguments -> `#VALUE!`. Numeric text coerced; blank ->
  `0` (confirm).

## Errors
- Non-numeric `lower_limit`/`upper_limit` -> `#VALUE!`.
- Legacy docs mention `#NUM!` for negative limits in Excel 2003 ATP;
  modern Excel accepts negatives (confirm current behavior).

## Examples
- `ERF(0.745)` = `0.707929` (approx `0.7079286694`)
- `ERF(1)` = `0.842701` (approx `0.8427007929`)
- `ERF(0, 1)` = `0.842701`
- `ERF(1, 2)` = `0.152621` (approx `0.1526214720` = `erf(2)-erf(1)`)
- `ERF(-1)` = `-0.842701`

## Compatibility notes
- Excel 2003+ (ATP earlier). `ERF.PRECISE` (Excel 2010+) is the modern
  1-arg form; `ERF(x)` = `ERF.PRECISE(x)`.
- In Excel 2007/ATP `ERF` rejected negative `lower_limit` with `#NUM!`;
  current Excel accepts negatives.

## Engine requirements
- Error-function numerics (approximation good to ~1e-15; e.g.
  Abramowitz-Stegun or rational Chebyshev). std-only.

## Open questions
- Does modern Excel `ERF` still allow a negative `lower_limit` with
  `upper_limit` present (e.g. `ERF(-1, 1)` = `2*erf(1)`)? Expected yes
  — confirm.
