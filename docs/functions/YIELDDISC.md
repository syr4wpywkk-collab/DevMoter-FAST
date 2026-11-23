# YIELDDISC

`YIELDDISC(settlement, maturity, pr, redemption, [basis])` — annual
yield of a discounted (non-coupon) security.

## Arguments
- `settlement`, `maturity`: required date serials;
  `settlement < maturity`.
- `pr`: required; price per $100 face, `> 0`.
- `redemption`: required; redemption per $100 face, `> 0`.
- `basis`: optional, default `0`; codes 0..4.

## Semantics
- `YIELDDISC = (redemption - pr)/pr * B/DSM` where `DSM` = days
  settlement->maturity, `B` = year length per `basis`.
- Closed form; no iteration.

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `pr <= 0` or `redemption <= 0` -> `#NUM!`.
- `basis` outside 0..4 -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `YIELDDISC(39448, 39594, 98.45, 100, 1)` -> `0.0909...`? Excel doc
  example: 2008-02-16->2008-03-01? Use own: `YIELDDISC(45000,45090,
  98.75, 100, 3)` = (1.25/98.75)*365/90 = 0.0126582*4.0556 =
  `0.05133...`. Verify.
- `YIELDDISC(45000, 45360, 90, 100, 0)` -> `0.10` (30/360: full year;
  (10/90)*1 = 0.111 — recompute: (100-90)/90 * 360/360 = 0.1111.
  fixture: `0.1111...`).
- `YIELDDISC(45000, 45000, 98, 100)` -> `#NUM!`.

## Engine requirements
- Day-count conventions (shared; see `PRICE.md`).

## Open questions
- Basis-1 year length.
- `pr > redemption` allowed (negative yield)? Docs bound only `<=0`.
