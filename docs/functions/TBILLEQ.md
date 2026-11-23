# TBILLEQ

`TBILLEQ(settlement, maturity, discount)` — bond-equivalent yield
(BEY) for a Treasury bill given its discount rate.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`, span <= one year (same bound as
  TBILLPRICE).
- `discount`: required; T-bill discount rate, `> 0`.

## Semantics
- `DSM = maturity - settlement`.
- For `DSM <= 182`: `TBILLEQ = (365 * discount) / (360 - discount * DSM)`.
- For `DSM > 182`: a quadratic coupon-equivalent formula applies
  (bond-equivalent yield over a half-year boundary) — the full
  closed form from the Treasury convention:
  `BEY = ( -b + sqrt(b^2 - 4ac) ) / (2a)` with
  `a = DSM/(2*365) - 0.25`, `b = DSM/365`, `c = -(PRICE-100)/100`? —
  exact published formula: for maturity > 182 days, BEY solves
  `P = 100 * (1 + BEY*DSM/365 ...)`. **Implement per Treasury/Excel
  documented formula** — mark coefficients **SPEC-OPEN** pending an
  authoritative reference (Microsoft docs state TBILLEQ "is
  calculated as (365 × rate)/(360 − (rate × DSM))" without noting the
  >182-day branch; the longer formula appears in Treasury docs —
  confirm which Excel actually uses).

## Coercion / errors
- As TBILLPRICE: `#NUM!` for `discount <= 0`,
  `settlement >= maturity`, span > one year; `#VALUE!` on coercion
  failure.
- Denominator `360 - discount*DSM <= 0` -> `#NUM!`/`#DIV/0!` —
  confirm.

## Examples
- `TBILLEQ(39531, 39593, 0.0914)` -> `0.094151...` (Excel doc example
  ≈ 9.4151%).
- `TBILLEQ(45000, 45090, 0.05)` -> `0.05133539...`
  (365*0.05/(360-0.05*90) = 18.25/355.5).
- `TBILLEQ(45000, 45000, 0.05)` -> `#NUM!`.

## Open questions
- Exact formula branch for DSM > 182 days.
- Denominator-zero error class.
