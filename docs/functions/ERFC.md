# ERFC

`ERFC(x)` — returns the complementary error function,
`erfc(x) = 1 - erf(x)`.

## Arguments
- `x`: required numeric; lower bound of the complementary integral.

## Semantics
- `erfc(x) = 2/sqrt(pi) * integral_x^inf e^{-t^2} dt`; range `(0, 2)`.
- Must be computed directly (not `1 - erf(x)`) to preserve accuracy for
  large `x` where `erf(x)` rounds to `1` — document the algorithm.

## Errors
- Non-numeric `x` -> `#VALUE!`.
- Legacy ATP versions returned `#NUM!` for negative `x`; modern Excel
  accepts negatives (confirm).

## Examples
- `ERFC(1)` = `0.157299` (approx `0.1572992071`)
- `ERFC(0)` = `1`
- `ERFC(0.5)` = `0.479500` (approx `0.4795001222`)
- `ERFC(-1)` = `1.842701` (approx `1.8427007929`)

## Compatibility notes
- Excel 2003+ (ATP earlier). `ERFC.PRECISE` is the Excel 2010+
  equivalent.

## Engine requirements
- erfc numerics that avoid catastrophic cancellation (scaled
  asymptotic expansion for large positive `x`).

## Open questions
- Negative-`x` acceptance in current Excel (expected yes) — confirm.
