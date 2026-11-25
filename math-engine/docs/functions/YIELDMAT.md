# YIELDMAT

`YIELDMAT(settlement, maturity, issue, rate, pr, [basis])` — annual
yield of a security paying interest at maturity.

## Arguments
- `settlement`, `maturity`, `issue`: required date serials;
  `issue <= settlement < maturity`.
- `rate`: required; rate at issue, `>= 0`.
- `pr`: required; price per $100 face, `> 0`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- Closed form (Microsoft documented):
  `YIELDMAT = ( (1 + (DIM/B)*rate - (pr/100 + (A/B)*rate)) /
   (pr/100 + (A/B)*rate) ) * (B/DSM)`
  where `DIM` = days issue->maturity, `A` = days issue->settlement,
  `DSM` = days settlement->maturity, `B` = basis year length.

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `rate < 0`, `pr <= 0` -> `#NUM!`.
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `YIELDMAT(39535, 39614, 39484, 0.0625, 99.9845, 0)` ->
  `0.0810...`? Excel doc example ≈ `0.090954` — verify exact fixture
  against reference (published example: settlement 2008-03-15,
  maturity 2008-11-03, issue 2007-11-08, rate 6.25%, pr 100.0123,
  basis 0 -> 0.060954? pin during implementation).
- `YIELDMAT(45000, 45365, 44635, 0.08, 100, 3)` -> `~0.08` (par).
- `YIELDMAT(45000, 45000, 44000, 0.05, 100)` -> `#NUM!`.

## Engine requirements
- Day-count conventions (shared; see `PRICE.md`).

## Open questions
- Basis-1 year length rule.
- `issue > settlement` error class.
