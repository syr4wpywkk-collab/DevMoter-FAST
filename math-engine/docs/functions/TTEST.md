# TTEST

`TTEST(array1, array2, tails, type)` — probability associated with
a Student's t-test.

Legacy compatibility function; modern equivalent is `T.TEST`
(identical signature).

## Arguments
- `array1`, `array2`: required ranges/arrays.
- `tails`: required; truncated; `1` -> one-tailed, `2` ->
  two-tailed.
- `type`: required; truncated; `1` = paired, `2` = two-sample
  equal variance (homoscedastic), `3` = two-sample unequal
  variance (heteroscedastic).

## Coercion
- Range elements: text/booleans/blanks ignored; errors propagate.
- `tails`/`type`: numeric scalars, truncated.

## Semantics
- `type = 1` (paired): requires equal element counts; computes t on
  the pairwise differences; df = n-1.
- `type = 2`: pooled-variance t; df = n1 + n2 - 2.
- `type = 3`: Welch's t; df via Welch–Satterthwaite.
- Result: `TDIST(|t|, df, tails)`-equivalent probability.

## Errors
- `tails` not in `{1,2}` or `type` not in `{1,2,3}` -> `#NUM!`.
- `type = 1` with different element counts -> `#N/A`.
- Fewer than 2 numeric values where required, or zero variance
  making t undefined -> `#DIV/0!`.
- Error element propagates.

## Engine requirements
- Incomplete beta (via `TDIST`) + variance stats.

## Examples
- `TTEST({6,7,9,15,21}, {20,28,31,38,40}, 2, 1)` -> `0.196016`
  (Microsoft docs example)
- `TTEST({6,7,9,15,21}, {20,28,31,38,40}, 1, 1)` -> `0.098008`
  (half of two-tailed — paired t symmetric)
- `TTEST({1,2,3}, {1,2,3,4}, 2, 1)` -> `#N/A`
- `TTEST({1,2,3}, {1,2,3}, 2, 4)` -> `#NUM!`

## Open questions
- `type = 2/3` with different element counts is allowed — confirm
  (docs: only paired requires equal counts).
- Non-integer df for type 3 used directly in TDIST-like tail —
  Excel interpolates df? — confirm handling.
