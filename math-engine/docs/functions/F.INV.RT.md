# F.INV.RT

`F.INV.RT(probability, deg_freedom1, deg_freedom2)` — inverse of the
right-tailed F probability; `= F.INV(1 - p, df1, df2)`.

## Arguments / Errors
- Same domains as `F.INV`; `p` outside `[0,1]` -> `#NUM!`; non-numeric
  -> `#VALUE!`.

## Examples
- `F.INV.RT(0.01,6,4)` -> `15.20686486`
- `F.INV.RT(0.99,6,4)` -> `0.10931...` (compute exactly)
- `F.INV.RT(0.5,1,1)` -> `1`
- `F.INV.RT(1.5,6,4)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `FINV` identical.

## Engine requirements
- **Distribution numerics**: see `F.INV`.

## Open questions
- Boundary `p` values.
