# ACCRINTM

`ACCRINTM(issue, maturity, rate, [par], [basis])` — returns the accrued
interest for a security that pays interest **at maturity** (e.g. a
zero-coupon bond with a stated rate).

## Arguments
- `issue`: issue date. Required.
- `maturity`: maturity date. Required.
- `rate`: annual interest rate. Required.
- `par`: par value. Optional; default `1000`.
- `basis`: day-count basis `0`-`4` (see `ACCRINT.md`). Optional;
  default `0`.

## Semantics
`ACCRINTM = par * rate * (A / D)` where `A` is the number of days from
`issue` to `maturity` and `D` is the days-per-year divisor, both per
`basis`. Simple proration — no coupon schedule is needed.

## Coercion and errors
- Same date/numeric coercion and truncation rules as `ACCRINT`.
- `issue >= maturity` -> `#NUM!`.
- `rate <= 0` or `par <= 0` -> `#NUM!`.
- `basis` outside `0..4` -> `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)` | `20.54794521` (75 actual days / 365) |
| `ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,0)` | `20.55555556` (74 days 30/360) |
| `ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,5000,3)` | `102.7397260` |
| `ACCRINTM(DATE(2008,6,15),DATE(2008,4,1),0.1,1000,3)` | `#NUM!` |

## Compatibility
Present since early Excel; `par` default `1000` matches Excel when the
argument is omitted or empty.

## Open questions
- Basis `1` (actual/actual) divisor for at-maturity securities: Excel
  uses actual days in the year (365/366) — confirm whether the year is
  anchored at `issue` or split across the interval.
