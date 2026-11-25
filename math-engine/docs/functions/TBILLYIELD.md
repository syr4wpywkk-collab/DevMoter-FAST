# TBILLYIELD

`TBILLYIELD(settlement, maturity, price)` — yield of a Treasury bill
from its price per $100 face.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`, span <= one year.
- `price`: required; must be `> 0`.

## Semantics
- `DSM = maturity - settlement`.
- `TBILLYIELD = (100 - price)/price * 360/DSM` — this is the
  *discount-basis* yield? No: TBILLYIELD returns the bond-equivalent
  money-market yield `(100-pr)/pr * 360/DSM` per Microsoft docs.
  (TBILLEQ converts discount rate to bond-equivalent yield; TBILLYIELD
  converts price to yield.)

## Coercion / errors
- As `TBILLPRICE`: date truncation, `#VALUE!` coercion, `#NUM!` for
  `price <= 0`, `settlement >= maturity`, span > one year.
- `price >= 100` -> negative/zero yield — allowed? Docs don't forbid;
  `price = 100` -> `0`. Confirm negative yields pass through.

## Examples
- `TBILLYIELD(45000, 45090, 98.75)` -> `0.05063291...`
  ((100-98.75)/98.75 * 360/90 = 1.25/98.75 * 4).
- `TBILLYIELD(39531, 39593, 98.45)` -> `0.0917...` approx.
- `TBILLYIELD(45000, 45000, 98)` -> `#NUM!`.
- `TBILLYIELD(45000, 45090, 0)` -> `#NUM!`.

## Open questions
- Whether `price >= 100` is an error (docs suggest only `price <= 0`
  errors).
- One-year span boundary (same question as TBILLPRICE).
