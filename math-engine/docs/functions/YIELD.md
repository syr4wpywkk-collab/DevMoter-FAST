# YIELD

`YIELD(settlement, maturity, rate, pr, redemption, frequency, [basis])` —
yield to maturity of a periodic-interest security.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`.
- `rate`: required; annual coupon rate, `>= 0`.
- `pr`: required; price per $100 face, `> 0`.
- `redemption`: required; redemption per $100 face.
- `frequency`: `1`, `2`, or `4`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- **One coupon period remaining** (settlement in last period):
  closed form — `YIELD = ((redemption/100 + rate/freq) -
  (pr/100 + A/(E...))) * freq * E/DSR` per Microsoft documented
  formula `YIELD = ((redemption/100 + rate/frequency) - (pr/100 +
  (A/E * rate/frequency))) * (frequency * E / DSR)` where
  `E`=days in coupon period, `DSR`=days settlement->redemption,
  `A`=days period-start->settlement.
- **More than one period**: no closed form — Excel iterates (Newton)
  to solve PRICE(pr) = given; ~100-iteration cap; initial guess
  undocumented.
- Returns the **bond-equivalent** annualized yield (`yld/freq`
  per-period convention).

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `rate < 0`, `pr <= 0`, `redemption <= 0` -> `#NUM!`.
- `frequency` not in {1,2,4} -> `#NUM!`.
- `basis` outside 0..4 -> `#NUM!`.
- Iteration non-convergence -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `YIELD(39448, 40179, 0.0625, 95.04287, 100, 2, 0)` ->
  `0.0650000...`? Excel doc example: settlement 2008-02-15, maturity
  2016-11-15, coupon 5.75%, pr 95.04287, freq 2, basis 0 ->
  `0.065000005` ≈ 6.5%. Verify digits.
- `YIELD(45000, 46800, 0.10, 100, 100, 2, 0)` -> `0.10` (par bond —
  requires settlement on a coupon date; verify date choice).
- `YIELD(45000, 45365, 0, 95.238, 100, 1, 3)` -> `0.05` (zero-coupon;
  verify).
- `YIELD(45000, 45000, 0.05, 100, 100, 2)` -> `#NUM!`.

## Engine requirements
- Day-count conventions + coupon-date stepping (see `PRICE.md`);
  iterative solver.

## Open questions
- Solver tolerance/guess and convergence domain.
- Negative yields: whether `pr > redemption + coupons` (implying
  yld<0) returns `#NUM!` or a negative yield in modern Excel.
