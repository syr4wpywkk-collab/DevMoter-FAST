# NEGBINOM.DIST

`NEGBINOM.DIST(number_f, number_s, probability_s, cumulative)` —
negative binomial: probability of `number_f` failures before
`number_s`-th success (Excel's parametrization). Excel 2010+; legacy
`NEGBINOMDIST` (non-cumulative only).

## Arguments
- `number_f`: required; failures, truncated to integer; `>= 0` else
  `#NUM!`.
- `number_s`: required; threshold successes, truncated to integer;
  `>= 1` else `#NUM!`.
- `probability_s`: required; `0 <= p <= 1`, else `#NUM!`. (Whether
  `p=0`/`p=1` edge cases error or return degenerate values — confirm;
  docs say `#NUM!` outside `[0,1]`.)
- `cumulative`: required boolean; `TRUE` = CDF, `FALSE` = PMF.

## Semantics
- PMF: `C(f + s - 1, s - 1) * p^s * (1-p)^f`.
- CDF: sum of PMF over `0..f`.
- Non-numeric -> `#VALUE!`.

## Errors
- `number_f < 0` or `number_s < 1` -> `#NUM!`.
- `p` outside `[0,1]` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `NEGBINOM.DIST(10, 5, 0.25, FALSE)` -> `0.055048660...` (Excel doc
  example: `0.0550487`).
- `NEGBINOM.DIST(10, 5, 0.25, TRUE)` -> `0.313514058...` (Excel doc:
  `0.3135141`).
- `NEGBINOM.DIST(0, 1, 0.5, FALSE)` -> `0.5`.

## Open questions
- Integer truncation of `number_f`/`number_s` (docs say truncated —
  confirm like `BINOM.DIST`).
- `p = 0` / `p = 1` degenerate behavior.
