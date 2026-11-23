# INTRATE

`INTRATE(settlement, maturity, investment, redemption, [basis])` —
returns the interest rate for a fully invested security (simple yield,
not compounded).

## Arguments
- `settlement`, `maturity`: dates; `settlement < maturity`.
- `investment`: amount invested. Required; `> 0`.
- `redemption`: amount received at maturity. Required; `> 0`.
- `basis`: `0`-`4` (see `ACCRINT.md`). Optional; default `0`.

## Semantics
`INTRATE = ((redemption − investment) / investment) · (B / DIM)` where
`DIM` is days settlement→maturity per `basis` and `B` is `360`
(basis 0/2/4), `365` (basis 3), or actual days-in-year (basis 1 —
divisor choice is an open question, same as `DISC`).

## Coercion and errors
- `settlement >= maturity` -> `#NUM!`.
- `investment <= 0` or `redemption <= 0` -> `#NUM!` (Excel docs say
  `investment <= 0` -> `#NUM!`; `redemption <= 0` — confirm).
- `basis` outside `0..4` -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,2)` | `0.05768` (90 actual days / 360) |
| `INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,3)` | `0.058481111` (90/365) |
| `INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,0)` | `0.05768` (90 days 30/360) |
| `INTRATE(DATE(2008,5,15),DATE(2008,2,15),1000000,1014420,2)` | `#NUM!` |

## Engine requirements
Day-count conventions (basis 0–4).

## Compatibility
Former Analysis ToolPak; built-in since Excel 2007. Related: `DISC`
(discount basis on redemption), `RECEIVED`.

## Open questions
- Basis `1` divisor convention.
- `redemption <= 0` and `redemption < investment` (negative rate is
  permitted — confirm).
