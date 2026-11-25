# COUPPCD

`COUPPCD(settlement, maturity, frequency, [basis])` — returns the previous
coupon date before the settlement date, as a serial number.

## Arguments
Same as `COUPNCD`; `basis` optional `0`-`4` default `0`, validated but
unused.

## Semantics
Latest coupon date `<= settlement`. When `settlement` lands exactly on a
coupon date, that date is the PCD (the NCD is then the following coupon).

## Errors
`#NUM!` for `settlement >= maturity`, bad `frequency`/`basis`;
`#VALUE!` for non-numeric text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2,1)` | `39036` (2006-11-15) |
| `COUPPCD(DATE(2007,5,15),DATE(2008,11,15),2,1)` | `39217` (2007-05-15 — settlement on coupon date) |
| `COUPPCD(DATE(2007,1,25),DATE(2008,11,15),4,0)` | `39036` (2006-11-15) |
| `COUPPCD(DATE(2008,11,16),DATE(2008,11,15),2,1)` | `#NUM!` |

## Engine requirements
Backward coupon-schedule generation from `maturity`.

## Open questions
- EOM anchoring rule (same as `COUPDAYBS`).
