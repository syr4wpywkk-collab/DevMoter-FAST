# DISC

`DISC(settlement, maturity, pr, redemption, [basis])` — returns the
discount rate for a security (e.g. a Treasury bill held to maturity).

## Arguments
- `settlement`, `maturity`: dates. Required; `settlement < maturity`.
- `pr`: price per 100 face value. Required; `> 0`.
- `redemption`: redemption value per 100 face value. Required; `> 0`.
- `basis`: day-count basis `0`-`4` (see `ACCRINT.md`). Optional;
  default `0`.

## Semantics
`DISC = ((redemption - pr) / redemption) * (B / DSM)` where `DSM` is
days settlement→maturity under `basis` and `B` is the days-per-year
divisor (`360` for basis 0/2/4, `365` for basis 3, actual-year days for
basis 1 — the basis-1 divisor choice is an open question).

## Coercion and errors
- `settlement >= maturity` -> `#NUM!`.
- `pr <= 0` or `redemption <= 0` -> `#NUM!`.
- `basis` outside `0..4` -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,1)` | `0.052420213` |
| `DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,0)` | `0.052071429` |
| `DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,3)` | `0.052420213` (141 actual days / 365) |
| `DISC(DATE(2007,6,15),DATE(2007,1,25),97.975,100,1)` | `#NUM!` |

## Engine requirements
Day-count conventions (basis 0–4).

## Open questions
- Basis `1` year divisor: actual days in year containing settlement vs
  average across the interval.
- `pr > redemption` (negative discount) is permitted — confirm.
