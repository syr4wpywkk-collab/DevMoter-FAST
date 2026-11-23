# FTEST

`FTEST(array1, array2)` — two-tailed probability that the variances
of `array1` and `array2` are not significantly different (F-test of
equality of variances).

Legacy compatibility function; modern equivalent is `F.TEST`. Note:
FTEST always returns the **two-tailed** probability.

## Arguments
- `array1`, `array2`: required ranges/arrays of numeric data.

## Coercion
- Range elements: text, booleans, blanks ignored; errors propagate.
- Direct array-literal booleans/text — same coercion question as
  `VAR` (Open question).

## Semantics
- `F = var1 / var2` (sample variances, n-1 denominators).
- `FTEST = 2 * min(FDIST(F, n1-1, n2-1), 1 - FDIST(F, n1-1, n2-1))`
  — i.e., twice the smaller tail.
- Returns a probability in `(0, 1]`.

## Errors
- Fewer than 2 numeric values in either array -> `#DIV/0!`.
- Zero variance in either array -> `#DIV/0!`.
- Error element propagates.

## Engine requirements
- Incomplete beta function (via `FDIST`); `VAR.S`-style statistics.

## Examples
- `FTEST({6,7,9,15,21}, {20,28,31,38,40})` -> `0.648318` (Microsoft
  docs example)
- `FTEST({1,1,1}, {2,3,4})` -> `#DIV/0!` (zero variance)
- `FTEST({1}, {1,2,3})` -> `#DIV/0!`
- `FTEST({1,2,3,4,5,6,7,8,9,10},{1,2,3,4,5,6,7,8,9,10})` -> `1`
  (equal variances -> `2*min(t,1-t)` = 1 at F=1)

## Open questions
- Handling of pairwise alignment (arrays need not be same size —
  confirm sizes may differ; Excel allows different sizes).
- Exact rounding of the doubled-tail value near 1.
