# ODDFPRICE

`ODDFPRICE(settlement, maturity, issue, first_coupon, rate, yld,
redemption, frequency, [basis])` — price per $100 face of a security
with an odd (irregular-length) first coupon period.

## Arguments
- `settlement`, `maturity`, `issue`, `first_coupon`: required date
  serials; must satisfy `maturity > first_coupon > settlement >
  issue`.
- `rate`: required; coupon rate, `>= 0`.
- `yld`: required; yield, `>= 0` (negative yields — confirm).
- `redemption`: required; redemption per $100.
- `frequency`: `1`, `2`, or `4`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- Full documented formula (Microsoft) covering short/long first
  coupons, quasi-coupon period splitting `DFC`, and accrued interest
  via `A = DFC...`. Implement per the published ODDFPRICE formula:
  `PRICE = [ redemption/(1+y/f)^(N-1+DSC/E) + sum coupon terms +
  100*rate/f * DFC/E / (1+y/f)^(DSC/E) ... ] - 100*rate/f*A/E`
  — transcribe the exact Microsoft formula during implementation;
  do not approximate.
- Short first period: `DSC/E` exponent forms differ from long first
  period — the doc gives both branches.

## Errors
- Date ordering violated -> `#NUM!`.
- `rate<0`, `yld<0`, `redemption<=0`? -> `#NUM!`.
- `frequency` not in {1,2,4} -> `#NUM!`.
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `ODDFPRICE(39600, 40124, 39441, 39715, 0.0785, 0.0625, 100, 2, 0)`
  -> `113.5977...` (Excel doc example; verify digits).
- Odd-first-period cases: construct fixtures so `first_coupon -
  issue` is not a whole coupon period; pin against reference.
- `ODDFPRICE(45000, 45000, 44000, 44900, 0.05, 0.05, 100, 2)` ->
  `#NUM!` (ordering).

## Engine requirements
- Day-count conventions + quasi-coupon date stepping (see
  `PRICE.md`). This is the most formula-heavy of the bond functions —
  budget for careful transcription.

## Open questions
- Negative `yld` support in modern Excel.
- Basis-1 handling of quasi-coupon periods.
