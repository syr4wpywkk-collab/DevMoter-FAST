# COUPDAYBS

`COUPDAYBS(settlement, maturity, frequency, [basis])` — returns the number
of days from the beginning of the coupon period to the settlement date.

## Arguments
- `settlement`: settlement date. Required; truncated to integer.
- `maturity`: maturity date. Required.
- `frequency`: coupons per year: `1`, `2`, or `4`. Required.
- `basis`: day-count basis `0`-`4` (see `ACCRINT.md`). Optional;
  default `0`.

## Semantics
Returns days elapsed between the previous coupon date (`COUPPCD`) and
`settlement`, counted under `basis`. Requires coupon-schedule generation:
coupon dates are anchored at `maturity` and step backward by
`12/frequency` months.

## Errors
- `settlement >= maturity` -> `#NUM!`.
- `frequency` not in {1,2,4} -> `#NUM!`.
- `basis` outside `0..4` -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; error arguments propagate.

## Examples
| Formula | Result |
|---|---|
| `COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `71` (PCD 2006-11-15 → 2007-01-25) |
| `COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,0)` | `70` (30/360) |
| `COUPDAYBS(DATE(2007,5,15),DATE(2008,11,15),2,1)` | `0` (settlement on a coupon date) |
| `COUPDAYBS(DATE(2008,11,15),DATE(2007,1,25),2,1)` | `#NUM!` |

## Engine requirements
Day-count conventions and backward coupon-schedule generation from
`maturity`.

## Open questions
- End-of-month anchoring when `maturity` is the 29th–31st (e.g. maturity
  Aug 31 → coupon Feb 28): Excel clips to month end — confirm whether the
  anchor stays at the maturity day-of-month or becomes sticky EOM.
