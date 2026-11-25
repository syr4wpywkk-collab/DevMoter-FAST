# LINEST

`LINEST(known_ys, [known_xs], [const], [stats])` — least-squares linear
regression `y = m1*x1 + m2*x2 + ... + b`; returns coefficients as an array
(and optionally a 5-row statistics block).

## Arguments
- `known_ys`: required range/array of y values.
- `known_xs`: optional; same shape rules as Excel — if omitted, uses
  `1..n` as the single x. If supplied, one column per x-variable
  (or one row per x-variable when `known_ys` is a row vector).
- `const`: optional logical; `TRUE`/omitted computes intercept `b`,
  `FALSE` forces `b = 0`. Non-boolean values are coerced per the usual
  truthiness rules (confirm coercion of numeric `const`).
- `stats`: optional logical; `FALSE`/omitted returns only the
  coefficient row; `TRUE` returns a `(p+1) x 5` block.

## Return value / spill
- With `stats=FALSE`: a 1 x (p+1) row array — coefficients in
  **reverse x order** (`m_p, ..., m1, b`). For a single x this is
  `{m, b}`. In pre-dynamic-array Excel it required Ctrl+Shift+Enter;
  here it is a natural spill/array result.
- With `stats=TRUE`: `(p+1)` rows x 5 columns. Rows: coefficients;
  standard errors; `R^2`, SE of y, `#N/A`s; F-statistic, df; SS_reg,
  SS_resid. Unused cells of the 5-column block are `#N/A`.
- `const=FALSE`: `b` slot returns `0`, and the `b` standard-error cell
  is `#N/A`.

## Coercion & errors
- Text/boolean/blank cells inside `known_ys`/`known_xs` — Excel's exact
  filtering rule (ignore-pair vs `#VALUE!`) is **Open question**;
  documented only loosely. Error cells propagate.
- If `known_xs` dimensions are incompatible with `known_ys` -> `#REF!`
  (Excel reports `#REF!`, not `#VALUE!` — confirm).
- Collinear/redundant x columns are dropped with coefficient `0` (Excel
  behavior; tolerance threshold undocumented — Open question).
- Fewer than `p+1` data points (exact fit / underdetermined) -> Excel
  still returns values; df = 0 makes some stats `#N/A`/`#DIV/0!`.

## Examples
- `LINEST({2;4;6;8}, {1;2;3;4})` -> `{2, 0}` (m=2, b=0).
- `LINEST(A1:A4)` with `A1:A4 = 3,5,7,9` -> `{2, 1}` (x=1..4 implicit).
- `LINEST(B1:B5, A1:A5, TRUE, TRUE)` returns a 2x5 block; top-left is
  the slope.
- `LINEST({1;2;3;4}, {1;2;3;4}, FALSE)` -> `{1, 0}`.

## Open questions
- Non-numeric cell handling inside inputs.
- Collinearity tolerance and dropped-column detection threshold.
- Behavior when `known_xs` is a wider-than-tall matrix (multiple x
  variables) vs transposed orientation.
