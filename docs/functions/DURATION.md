# DURATION

`DURATION(settlement, maturity, coupon, yld, frequency, [basis])` —
returns the Macaulay duration (in years) of a security paying periodic
interest, assuming \$100 par value.

## Arguments
- `settlement`, `maturity`: dates; `settlement < maturity`.
- `coupon`: annual coupon rate. Required; `>= 0` (`< 0` -> `#NUM!`).
- `yld`: annual yield. Required; `>= 0` (`< 0` -> `#NUM!`).
- `frequency`: `1`, `2`, or `4`. Required.
- `basis`: `0`-`4` (see `ACCRINT.md`). Optional; default `0`.

## Semantics
Weighted average time (in years) of the security's cash flows:
`DURATION = Σᵢ (tᵢ · PVᵢ) / (frequency · Price)` where each cash flow is
`100·coupon/frequency` (plus `100` at maturity), `tᵢ` is measured in
coupon periods from settlement using the `basis` day counts within the
current period, and discounting is at `yld/frequency` per period.

## Coercion and errors
- `settlement >= maturity` -> `#NUM!`.
- `coupon < 0`, `yld < 0` -> `#NUM!`.
- `frequency` ∉ {1,2,4}, `basis` ∉ 0..4 -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)` | `5.9937750` |
| `DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,1,0)` | `6.1490679` |
| `DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.08,2,0)` | `6.0591937` (bond priced at par) |
| `DURATION(DATE(2016,1,1),DATE(2008,1,1),0.08,0.09,2)` | `#NUM!` |

## Engine requirements
Coupon-schedule generation (`COUPNCD`/`COUPPCD`/`COUPNUM`/`COUPDAYS`
machinery) and day-count conventions.

## Compatibility
Macaulay duration; `MDURATION` = `DURATION / (1 + yld/frequency)`.

## Open questions
- Whether the within-period time uses `basis` day counts or always
  actual days (Excel docs imply `basis` affects `DSC`/`E` terms —
  confirm basis 0/4 effects).
- Behavior when `settlement` falls on a coupon date.
