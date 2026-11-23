# F.INV

`F.INV(probability, deg_freedom1, deg_freedom2)` — inverse of the
left-tailed F CDF.

## Arguments
- `probability`: `0 < p <= 1`? Docs say `0 <= p <= 1`; `p = 0` -> `0`,
  `p = 1` -> +∞/`#NUM!` — **confirm boundaries**.
- `deg_freedom1`, `deg_freedom2`: `1 <= df <= 10^10`, truncated.

## Errors
- `p` outside `[0,1]` -> `#NUM!`; df out of range -> `#NUM!`;
  non-numeric -> `#VALUE!`.

## Examples
- `F.INV(0.01,6,4)` -> `0.10931...` (lower 1% point; compute exactly)
- `F.INV(0.99,6,4)` -> `15.20686486` (round-trip of `F.DIST` example)
- `F.INV(0.5,1,1)` -> `1`
- `F.INV(-0.5,6,4)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `FINV` is the *right*-tail inverse:
  `FINV(p,a,b) = F.INV.RT(p,a,b)`.

## Engine requirements
- **Distribution numerics**: incomplete beta inverse.

## Open questions
- `p = 0` / `p = 1` boundary results.
