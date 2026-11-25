# COUPDAYSNC

`COUPDAYSNC(settlement, maturity, frequency, [basis])` — returns the
number of days from the settlement date to the next coupon date.

## Arguments
Same as `COUPDAYBS`: `settlement`, `maturity`, `frequency` (1, 2, 4),
optional `basis` (`0`-`4`, default `0`).

## Semantics
Days between `settlement` and `COUPNCD(settlement, maturity, frequency)`
under `basis`. For basis `1` this is `COUPDAYS - COUPDAYBS` of the
containing period.

## Errors
Same as `COUPDAYBS`: `#NUM!` for `settlement >= maturity`, bad
`frequency`/`basis`; `#VALUE!` for non-numeric text.

## Examples
| Formula | Result |
|---|---|
| `COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `110` (2007-01-25 → 2007-05-15) |
| `COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,0)` | `110` (30/360) |
| `COUPDAYSNC(DATE(2007,5,15),DATE(2008,11,15),2,1)` | `184` (settlement on coupon date → next period) |
| `COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),5,1)` | `#NUM!` |

## Engine requirements
Day-count conventions and forward coupon-schedule generation.

## Open questions
- EOM anchoring rule (same as `COUPDAYBS`).
- Behavior when `settlement` falls exactly on a coupon date (treated as
  start of next period — confirm).
