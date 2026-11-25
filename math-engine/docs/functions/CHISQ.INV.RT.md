# CHISQ.INV.RT

`CHISQ.INV.RT(probability, deg_freedom)` — inverse of the right-tailed
chi-squared probability: `x` with `P(X >= x) = probability`.
Equivalent to `CHISQ.INV(1 - p, df)`.

## Arguments / Errors
- Same domains as `CHISQ.INV`: `0 <= p <= 1`, `1 <= df <= 10^10`;
  violations -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `CHISQ.INV.RT(0.05,10)` -> `18.307038053275146` (χ² upper 5% point)
- `CHISQ.INV.RT(0.95,10)` -> `3.9402991365242097`
- `CHISQ.INV.RT(0.4795001221869535,1)` -> `0.5` (round-trip of
  `CHISQ.DIST.RT`)
- `CHISQ.INV.RT(1.5,10)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CHIINV` (same signature).

## Engine requirements
- **Distribution numerics**: see `CHISQ.INV`.

## Open questions
- Boundary `p` values (0, 1) — confirm.
