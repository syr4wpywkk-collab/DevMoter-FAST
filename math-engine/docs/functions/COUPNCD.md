# COUPNCD

`COUPNCD(settlement, maturity, frequency, [basis])` — returns the next
coupon date after the settlement date, as a serial number.

## Arguments
- `settlement`, `maturity`, `frequency` (1, 2, 4): as `COUPDAYBS`.
- `basis`: optional `0`-`4`, default `0`. **Accepted but does not affect
  the result** — the returned date is calendar-based. (Confirm: Excel
  ignores it.)

## Semantics
First coupon date strictly after `settlement`. Coupon dates are anchored
at `maturity`, stepping backward/forward by `12/frequency` months. Result
is a serial date number (formatting to a date display is a host concern).

## Errors
`#NUM!` for `settlement >= maturity`, bad `frequency`/`basis`;
`#VALUE!` for non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `39217` (2007-05-15) |
| `COUPNCD(DATE(2007,5,15),DATE(2008,11,15),2,1)` | `39401` (2007-11-15) |
| `COUPNCD(DATE(2007,1,25),DATE(2008,11,15),4,0)` | `39128` (2007-02-15) |
| `COUPNCD(DATE(2008,11,15),DATE(2008,11,15),2,1)` | `#NUM!` |

## Engine requirements
Backward coupon-schedule generation from `maturity`.

## Open questions
- EOM anchoring when `maturity` day-of-month exceeds a target month's
  length (clip vs carry).
- Whether `basis` is validated even though it is unused (expected yes).
