# ISPMT

`ISPMT(rate, per, nper, pv)` — returns the interest paid during a
specific period of a loan with **equal principal** repayments (not the
constant-payment amortization used by `IPMT`).

## Arguments
- `rate`: rate per period. Required.
- `per`: period index, **0-based**: `0 <= per <= nper - 1`. Required.
- `nper`: total periods. Required.
- `pv`: present value. Required.

## Semantics
Equal-principal schedule: principal `pv/nper` repaid each period, so
`ISPMT(rate, per, nper, pv) = pv · rate · (per − nper) / nper`
— i.e. `-rate · (outstanding balance at start of the period)`, where
the balance declines linearly. `per = 0` is the first period.

## Coercion and errors
- `nper = 0` -> `#DIV/0!`.
- `per` outside `0..nper-1`: Excel still evaluates (returns values
  beyond the loan) — **confirm**; no documented `#NUM!`.
- Non-numeric text -> `#VALUE!`; errors propagate.
- Truncation of `per`/`nper` to integers — confirm.

## Examples
| Formula | Result |
|---|---|
| `ISPMT(0.1/12,0,36,8000000)` | `-66666.66667` (full balance outstanding) |
| `ISPMT(0.1/12,1,36,8000000)` | `-64814.81481` |
| `ISPMT(0.1/12,2,36,8000000)` | `-62962.96296` |
| `ISPMT(0.1/12,1,0,8000000)` | `#DIV/0!` |

## Compatibility
Legacy function kept for Lotus 1-2-3 compatibility; note the unusual
**0-based `per`** (vs `IPMT`'s 1-based) — a common porting bug source.

## Open questions
- Out-of-range `per` handling (extrapolation vs `#NUM!`).
- Integer truncation of `per`/`nper`.
