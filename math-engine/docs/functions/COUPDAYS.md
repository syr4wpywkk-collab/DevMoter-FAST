# COUPDAYS

`COUPDAYS(settlement, maturity, frequency, [basis])` — returns the number
of days in the coupon period that contains the settlement date.

## Arguments
Same as `COUPDAYBS`: `settlement`, `maturity`, `frequency` (1, 2, 4),
optional `basis` (`0`-`4`, default `0`).

## Semantics
- Basis `0`, `2`, `4`: returns `360/frequency` (i.e. `360`, `180`, `90`).
- Basis `3`: returns `365/frequency` — a non-integer for `frequency` 2
  and 4 (`182.5`, `91.25`); confirm whether Excel truncates.
- Basis `1`: actual days between `COUPPCD` and `COUPNCD` of the period
  containing `settlement`.

## Errors
Same as `COUPDAYBS`: `#NUM!` for `settlement >= maturity`, bad
`frequency`, bad `basis`; `#VALUE!` for non-numeric text.

## Examples
| Formula | Result |
|---|---|
| `COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `181` (2006-11-15 → 2007-05-15) |
| `COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,0)` | `180` |
| `COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),4,0)` | `90` |
| `COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,3)` | `182.5` (confirm integer vs fractional) |

## Engine requirements
Coupon-schedule generation (basis `1`); trivial otherwise.

## Open questions
- Whether basis `3` returns `182.5`/`91.25` or a truncated integer.
- EOM anchoring rule (same as `COUPDAYBS`).
