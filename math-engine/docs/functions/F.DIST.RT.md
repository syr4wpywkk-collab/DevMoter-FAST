# F.DIST.RT

`F.DIST.RT(x, deg_freedom1, deg_freedom2)` — right-tailed F probability
`P(X >= x)`; equals `1 - F.DIST(x, df1, df2, TRUE)` (implement via the
complementary incomplete beta for tail accuracy).

## Arguments / Errors
- Same domains as `F.DIST`: `x >= 0`, `1 <= df <= 10^10`; violations
  -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `F.DIST.RT(15.20686486,6,4)` -> `0.01` (approx)
- `F.DIST.RT(1,1,1)` -> `0.5`
- `F.DIST.RT(2.8860466,2,10)` -> `0.1048...` (≈ F-table value;
  compute exactly for fixture)
- `F.DIST.RT(-1,2,3)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `FDIST` identical.

## Engine requirements
- **Distribution numerics**: incomplete beta (see `F.DIST`).

## Open questions
- None beyond `F.DIST`'s df bound.
