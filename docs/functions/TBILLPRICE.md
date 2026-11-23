# TBILLPRICE

`TBILLPRICE(settlement, maturity, discount)` — price per $100 face of
a Treasury bill.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`, and `maturity - settlement <= one year`
  (actual days).
- `discount`: required; the discount rate, must be `> 0`.

## Semantics
- `DSM = maturity - settlement` (days).
- `TBILLPRICE = 100 * (1 - discount * DSM / 360)`.
- US T-bill convention: actual/360.

## Coercion
- Date serials: direct scalars truncated to integer (date args
  truncate fractional part — confirm, consistent with other security
  functions).
- Non-coercible -> `#VALUE!`.

## Errors
- `discount <= 0` -> `#NUM!`.
- `settlement >= maturity` or `maturity - settlement > 365`... Excel:
  "more than one year" -> `#NUM!`; boundary is calendar-year vs 365
  days — confirm (docs say "more than one year").
- Result price <= 0 -> `#NUM!`? (huge discount) — confirm.

## Examples
- `TBILLPRICE(45704, 45896, 0.09)` -> `95.2` (DSM=192;
  100*(1-0.09*192/360) = 100*(1-0.048)).
- `TBILLPRICE(39531, 39593, 0.0914)` -> `98.4271...` (DSM=62;
  100*(1-0.0914*62/360) = 100*(1-0.01573556) — Excel doc example,
  verify final digits).
- `TBILLPRICE(45000, 45090, 0.05)` -> `98.75` (100*(1-0.05*90/360)).
- `TBILLPRICE(45000, 45180, 0.05)` -> `97.5`.
- `TBILLPRICE(45000, 45000, 0.05)` -> `#NUM!`.
- `TBILLPRICE(45000, 45500, 0.05)` -> `#NUM!` (> 1 year — confirm
  boundary).

## Open questions
- "One year" bound: 365 vs 366 (leap) vs YEARFRAC-style.
- Whether negative price domain yields `#NUM!`.
