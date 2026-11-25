# MDURATION

`MDURATION(settlement, maturity, coupon, yld, frequency, [basis])` —
returns the modified Macaulay duration (in years) of a security paying
periodic interest, assuming \$100 par value.

## Arguments
Same as `DURATION` (see `DURATION.md`): `settlement`, `maturity`,
`coupon` (>= 0), `yld` (>= 0), `frequency` (1, 2, 4), optional `basis`
(`0`-`4`, default `0`).

## Semantics
`MDURATION = DURATION(...) / (1 + yld/frequency)` — measures price
sensitivity: `dP/P ≈ -MDURATION · dy`.

## Coercion and errors
Same as `DURATION`: `#NUM!` for `settlement >= maturity`, negative
`coupon`/`yld`, bad `frequency`/`basis`; `#VALUE!` for non-numeric
text; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)` | `5.7356698` |
| `MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,1,0)` | `5.6413466` |
| `MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.08,2,0)` | `5.8309564` (par bond) |
| `MDURATION(DATE(2016,1,1),DATE(2008,1,1),0.08,0.09,2)` | `#NUM!` |

## Engine requirements
`DURATION` machinery (coupon schedule + day counts).

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007.

## Open questions
- Same as `DURATION` (basis effect on within-period timing; coupon-date
  settlement).
