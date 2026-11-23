# COUPNUM

`COUPNUM(settlement, maturity, frequency, [basis])` — returns the number
of coupon payments between settlement and maturity, rounded up to the
nearest whole coupon.

## Arguments
Same as `COUPNCD`; `basis` optional `0`-`4` default `0`, validated but
unused.

## Semantics
Count of coupon dates strictly after `settlement` up to and including
`maturity`: the number of `12/frequency`-month steps from the NCD to
`maturity`. Always a positive integer when inputs are valid.

## Errors
`#NUM!` for `settlement >= maturity`, bad `frequency`/`basis`;
`#VALUE!` for non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `4` |
| `COUPNUM(DATE(2007,1,25),DATE(2009,11,15),2,1)` | `6` |
| `COUPNUM(DATE(2007,1,25),DATE(2008,11,15),4,0)` | `8` |
| `COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,9)` | `#NUM!` |

## Engine requirements
Coupon-schedule generation.

## Open questions
- EOM anchoring (same family-wide question).
