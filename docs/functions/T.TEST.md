# T.TEST

`T.TEST(array1, array2, tails, type)` — probability associated with a
Student's t-test. Excel 2010+; legacy `TTEST` (same args).

## Arguments
- `array1`, `array2`: required ranges/arrays.
- `tails`: required; `1` = one-tailed, `2` = two-tailed; anything else
  -> `#NUM!`.
- `type`: required; `1` = paired, `2` = two-sample equal variance
  (homoscedastic), `3` = two-sample unequal variance
  (Welch/heteroscedastic); else `#NUM!`.

## Coercion
- Pair exclusion rules for `type=1` (paired): non-numeric cell in
  either array drops the pair; counts must match? — paired requires
  equal cell counts else `#N/A` (confirm).
- `type=2/3`: arrays may differ in size; non-numeric cells ignored
  individually.
- `tails`/`type` truncated to integer? (confirm; non-integer like
  `1.5` -> `#NUM!`?).

## Semantics
- `type=1`: paired t on differences `d_i = x_i - y_i`;
  `t = mean(d)/(sd(d)/sqrt(n))`, df = n-1.
- `type=2`: pooled-variance t; df = n1+n2-2.
- `type=3`: Welch t; df via Welch–Satterthwaite (non-integer df).
- `tails=1` -> `T.DIST.RT(|t|, df)`? — Excel reports the one-tailed
  p-value consistently as `P(T >= t)` (sign matters — verify whether
  negative t gives `1 - tail` or `|t|` is used; documented as
  `P(T >= |t|)`? — Open question; LibreOffice uses `|t|`).
- `tails=2` -> `T.DIST.2T(|t|, df)`.

## Errors
- `tails`/`type` not in {1,2}/{1,2,3} -> `#NUM!`.
- `type=1` unequal counts -> `#N/A` (confirm); insufficient data /
  zero variance -> `#DIV/0!`.
- Errors propagate.

## Examples
- `T.TEST({3;4;5;8;9;1;2;4;5}, {6;19;3;2;14;4;5;17;1}, 2, 1)` ->
  `0.196016` (Excel doc example).
- `T.TEST` same data, `tails=1, type=1` -> `0.098008` (half of
  two-tailed when t>0 — confirm sign).
- `T.TEST(A1:A10, B1:B10, 2, 2)` pooled test.
- `T.TEST(x, y, 3, 1)` -> `#NUM!`.

## Open questions
- One-tailed sign convention (`|t|` vs signed).
- Paired-test count-mismatch error (`#N/A` vs `#VALUE!`).
- Truncation of `tails`/`type`.

## Engine requirements
- t-distribution numerics (incomplete beta) shared with `T.DIST`.
