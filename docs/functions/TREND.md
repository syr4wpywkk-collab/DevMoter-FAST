# TREND

`TREND(known_ys, [known_xs], [new_xs], [const])` — least-squares
linear trend: fitted y-values for given/new x-values. Array result
(spill).

## Arguments
- `known_ys`: required.
- `known_xs`: optional; omitted -> `1..n`.
- `new_xs`: optional; omitted -> same as `known_xs` (returns fitted
  values). Must have the same number of x-variables (columns) as
  `known_xs`; may have any number of rows (each row a prediction).
- `const`: optional logical; `FALSE` forces intercept 0 (same as
  `LINEST`).

## Semantics
- Fits `y = m1*x1 + ... + b` on known data (same solver as `LINEST`),
  evaluates on `new_xs`.
- Result is a vertical array with one row per `new_xs` row
  (horizontal if inputs are row-vectors — orientation mirrors input).

## Coercion & errors
- Same input filtering/error questions as `LINEST` (non-numeric cells,
  collinearity).
- `new_xs` column count != `known_xs` variables -> `#REF!` (per docs
  — confirm).
- Error cells propagate.

## Examples
- `TREND({2;4;6;8}, {1;2;3;4}, {5;6})` -> `{10;12}`.
- `TREND(B1:B12, A1:A12, A13:A15)` monthly-sales projection (Excel doc
  pattern).
- `TREND({3;5;7;9})` -> `{3;5;7;9}` (implicit x = 1..4, fitted values).
- `TREND({1;2;3;4}, {1;2;3;4}, {5}, FALSE)` -> `{5}` (through origin).

## Open questions
- Orientation when `known_ys` is a row vector vs column.
- Error code for `new_xs` shape mismatch (`#REF!` documented?).
- Collinearity handling identical to `LINEST` (expected).

## Engine requirements
- Shared least-squares solver with `LINEST`/`LOGEST`.
