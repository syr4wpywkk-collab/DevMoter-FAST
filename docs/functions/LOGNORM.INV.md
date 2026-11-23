# LOGNORM.INV

`LOGNORM.INV(probability, mean, standard_dev)` — inverse of the
lognormal CDF. Excel 2010+; legacy `LOGINV`.

## Arguments
- `probability`: required; must satisfy `0 < p < 1`, else `#NUM!`.
  Endpoints `0`/`1` are `#NUM!` (Excel does not return 0/+Inf —
  confirm).
- `mean`: required; mean of `ln(x)`.
- `standard_dev`: required; `> 0` else `#NUM!`.

## Semantics
- `LOGNORM.INV(p, mu, sigma) = EXP(NORM.S.INV(p) * sigma + mu)`.
- Round-trip: `LOGNORM.INV(LOGNORM.DIST(x,mu,sigma,TRUE),mu,sigma) ~= x`.

## Errors
- `p <= 0` or `p >= 1` -> `#NUM!`; `sigma <= 0` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `LOGNORM.INV(0.0390836, 3.5, 1.2)` -> approximately `4.000...`
  (inverts the `LOGNORM.DIST` doc example).
- `LOGNORM.INV(0.5, 3.5, 1.2)` -> `EXP(3.5) = 33.11545195...`.
- `LOGNORM.INV(0.5, 0, 1)` -> `1`.

## Open questions
- Exact endpoint handling (p=0 or p=1: `#NUM!` per docs — confirm).
- Accuracy near p -> 0/1 (underflow/overflow to `0`/`#NUM!`?).

## Engine requirements
- Needs the same inverse-normal implementation as `NORM.S.INV`.
