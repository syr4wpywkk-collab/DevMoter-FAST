# PRICEMAT

`PRICEMAT(settlement, maturity, issue, rate, yld, [basis])` — price
per $100 face of a security that pays interest at maturity.

## Arguments
- `settlement`, `maturity`, `issue`: required date serials;
  `issue <= settlement < maturity`.
- `rate`: required; interest (coupon) rate at issue, `>= 0`.
- `yld`: required; annual yield, `>= 0`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- Interest accrues from `issue` to `maturity`; price discounts the
  single maturity payment:
  `PRICEMAT = (100 + (DIM/B)*100*rate) / (1 + (DSM/B)*yld)
   - (A/B)*100*rate`
  where `DIM` = days issue->maturity, `DSM` = days
  settlement->maturity, `A` = days issue->settlement, `B` = year
  length per `basis` (documented Microsoft formula; B = 360/365 or
  actual-year for bases).

## Errors
- `settlement >= maturity`, `settlement < issue`? (docs: invalid
  dates -> `#NUM!`) -> `#NUM!`.
- `rate < 0` or `yld < 0` -> `#NUM!`.
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `PRICEMAT(39535, 39614, 39484, 0.025, 0.0305, 0)` -> `99.9844...`?
  Excel doc example yields ≈ `99.9845`. Verify.
- `PRICEMAT(45000, 45365, 44635, 0.08, 0.08, 3)` -> ~`100` par-ish
  (issued a year ago at same rate as yld; verify).
- `PRICEMAT(45000, 45000, 44000, 0.05, 0.05)` -> `#NUM!`.

## Engine requirements
- Day-count conventions (shared; see `PRICE.md`).

## Open questions
- Basis 1 `B` definition (actual days in the year — which year when a
  leap boundary is crossed?).
- `issue > settlement` error class.
