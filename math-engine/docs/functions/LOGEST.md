# LOGEST

`LOGEST(known_ys, [known_xs], [const], [stats])` — exponential
regression `y = b * m1^x1 * m2^x2 * ...`; same array/shape rules as
`LINEST`, computed by fitting `ln(y)` linearly.

## Arguments
Identical to `LINEST` (`known_ys`, `known_xs`, `const`, `stats`).
`const=FALSE` forces `b = 1` (not `b = 0` — the exponential analogue).

## Return value / spill
- `stats=FALSE`: `{m_p, ..., m1, b}` row array (growth factors, not
  slopes).
- `stats=TRUE`: same (p+1) x 5 block layout as `LINEST` — coefficients'
  standard errors, R^2 (of the log fit), SE_y, F, df, SS_reg, SS_resid.

## Coercion & errors
- All `known_ys` must be **positive** (`ln(y)` is taken): any `y <= 0`
  -> `#NUM!`? — Excel actually returns `#VALUE!`/`#NUM!` depending on
  version; **Open question** which error. Open-document references say
  `#VALUE!` for non-positive y (confirm).
- Shape/coercion/error rules otherwise identical to `LINEST`.

## Examples
- `LOGEST({2;4;8;16}, {1;2;3;4})` -> `{2, 1}` (y = 1 * 2^x).
- `LOGEST(A1:A3)` with `A1:A3 = 1,10,100` -> `{10, 0.1}`.
- `LOGEST({3;6;12;24}, {1;2;3;4}, TRUE, TRUE)` -> 2x5 stats block.

## Open questions
- Exact error for `y <= 0` (`#VALUE!` vs `#NUM!`).
- Same collinearity/orientation questions as `LINEST`.
