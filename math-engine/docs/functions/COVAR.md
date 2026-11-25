# COVAR

`COVAR(array1, array2)` — population covariance (average of the
products of paired deviations), NOT the sample covariance.

Legacy compatibility function; modern equivalents are
`COVARIANCE.P` (identical) and `COVARIANCE.S` (n-1 denominator —
different result).

## Arguments
- `array1`, `array2`: required ranges/arrays of equal size.

## Coercion
- Range/array elements: numbers and directly-entered numeric values
  counted; text, booleans, blanks **ignored** pairwise (if either
  member of a pair is non-numeric the pair is skipped — same rule as
  `CORREL`); error values propagate.

## Semantics
- `COVAR(x, y) = sum((x_i - mean_x)(y_i - mean_y)) / n` over the `n`
  valid pairs.

## Errors
- Different numbers of data points -> `#N/A`.
- Fewer than 1 valid pair (empty numeric sets) -> `#DIV/0!`.
- Error element in either array propagates.

## Examples
- `COVAR({3,2,4,5,6}, {9,7,12,15,17})` -> `5.2` (Microsoft docs
  example)
- `COVAR({1,2,3}, {4,5,6})` -> `0.6666667` (`2/3`)
- `COVAR({1,2,3}, {1,2})` -> `#N/A`
- `COVAR({}, {})` -> `#DIV/0!`

## Open questions
- Whether a single-pair input returns `0` (n=1, deviations zero) —
  expected `0`; confirm.
