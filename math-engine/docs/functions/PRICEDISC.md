# PRICEDISC

`PRICEDISC(settlement, maturity, discount, redemption, [basis])` —
price per $100 face of a discount security (no coupons; e.g. T-bill
style but general bases).

## Arguments
- `settlement`, `maturity`: required date serials,
  `settlement < maturity`.
- `discount`: required; discount rate, `> 0` (negative discount ->
  `#NUM!`; zero allowed? docs say `<0` errors — confirm 0 case).
- `redemption`: required; redemption per $100 face.
- `basis`: optional, default `0`; day-count codes 0..4 as `PRICE`.

## Semantics
- `PRICEDISC = redemption - discount * redemption * DSM/DEN` where
  `DSM/DEN` is the day-count fraction settlement->maturity per
  `basis` (for basis 0/4: 30/360 months; basis 1: act/act which for
  this function uses actual days / actual days in year — Excel uses
  `B` = days in year per basis; implement via shared YEARFRAC-like
  convention).

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `discount < 0` -> `#NUM!`.
- `redemption <= 0` -> `#NUM!` (confirm).
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `PRICEDISC(39448, 39594, 0.0525, 100, 2)` -> `97.8895...`? Excel doc
  example: 2008-02-16 to 2008-03-01? Use `PRICEDISC(39448,39594,
  0.05,100,0)` = 100*(1-0.05*...) with 30/360: DSM=144? verify —
  pin fixtures during implementation.
- `PRICEDISC(45000, 45180, 0.05, 100, 3)` -> `97.4657...`
  (100*(1-0.05*180/365)).
- `PRICEDISC(45000, 45180, 0.05, 100, 0)` -> `97.5` (30/360: 180 days
  counted exactly -> 0.5yr).
- `PRICEDISC(45000, 45000, 0.05, 100)` -> `#NUM!`.

## Engine requirements
- Day-count conventions (shared utility; see `PRICE.md`).

## Open questions
- Basis 1 (act/act) year-length rule for this function (365 vs actual
  year length — same ambiguity as YEARFRAC basis 1).
- `discount = 0` and `redemption = 0` boundary errors.
