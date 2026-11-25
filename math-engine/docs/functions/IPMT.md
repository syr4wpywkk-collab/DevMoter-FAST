# IPMT

`IPMT(rate, per, nper, pv, [fv], [type])` — returns the interest portion
of the payment for a given period of a constant-rate, constant-payment
loan.

## Arguments
- `rate`: rate per period. Required.
- `per`: period of interest, `1 <= per <= nper`. Required.
- `nper`: total periods. Required.
- `pv`: present value. Required.
- `fv`: future value (balloon). Optional; default `0`.
- `type`: `0` end-of-period (default), `1` beginning. Optional.

## Semantics
`IPMT = balance_at_start_of_period(per) · rate`, where the balance is
`FV(rate, per−1, pmt, pv)` for `type = 0`, or `FV(rate, per, pmt, pv)`
for `type = 1` (payments in advance; `per = 1, type = 1` → `0`). `pmt`
is the level payment `PMT(rate, nper, pv, fv, type)` — see `PMT` spec
(tracked elsewhere). Returned value is negative for `pv > 0`.

## Coercion and errors
- `per < 1` or `per > nper` -> `#NUM!`.
- Non-integer `per`/`nper`: truncated? **confirm** (Excel docs require
  integers; fractional values likely truncated).
- Non-numeric text -> `#VALUE!`; errors propagate.

## Examples
| Formula | Result |
|---|---|
| `IPMT(0.1/12,1,36,8000)` | `-66.66666667` |
| `IPMT(0.1/12,3,36,8000)` | `-63.46218957` |
| `IPMT(0.1,3,10,200000)` | `-17364.69341` |
| `IPMT(0.1/12,1,36,8000,,1)` | `0` (payments in advance, first period) |
| `IPMT(0.1/12,37,36,8000)` | `#NUM!` |

## Compatibility
Core annuity decomposition; `PPMT = PMT − IPMT`.

## Open questions
- Fractional `per`/`nper` truncation.
- Behavior when `rate = 0` (expected `-pv·0` → `0`? or `#DIV/0!` via
  `PMT` — confirm).
