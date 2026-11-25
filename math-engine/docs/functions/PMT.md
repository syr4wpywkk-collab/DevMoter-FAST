# PMT

`PMT(rate, nper, pv, [fv], [type])` — constant periodic payment for a
loan/annuity.

## Arguments
- `rate`: required; rate per period.
- `nper`: required; total number of periods.
- `pv`: required; present value (amount borrowed/invested at t=0).
- `fv`: optional, default `0` (target balance after last payment).
- `type`: optional, default `0`; `0` end-of-period, nonzero
  beginning-of-period.

## Semantics
- `r = rate`, `n = nper`:
  - `r <> 0`: `PMT = -(pv*(1+r)^n + fv) * r / ((1 + r*type) * ((1+r)^n - 1))`
    — equivalently `PMT = (pv + pv*(1+r)^n... )`; the canonical Excel
    arrangement is `PMT = (rate*(pv*(1+rate)^nper + fv)) / ((1+rate*type)*((1+rate)^nper - 1))`
    with sign convention: positive `pv` loan + `fv=0` -> negative
    payment (cash outflow).
  - `r = 0`: `PMT = -(pv + fv) / nper`.
- Sign convention: result has opposite sign to `pv` for a standard
  loan (`PMT(0.05, 12, 1000)` < 0).

## Coercion
- Direct-scalar; numeric text coerced; blanks in optional args behave
  as omitted (blank `fv` -> `0` — confirm); errors propagate.

## Errors
- `nper = 0` -> `#NUM!`? Excel returns `#DIV/0!` for `nper=0` —
  **confirm** (division by `nper` in the `r=0` path and by
  `(1+r)^n - 1` otherwise).
- `rate = -1`... `(1+r)^n` domain issues -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `PMT(0.005, 36, 10000)` -> `-304.219...` (36-mo loan at 0.5%/mo;
  verify final digits against reference).
- `PMT(0, 12, 1200)` -> `-100`.
- `PMT(0.005, 36, 10000, 0, 1)` -> `-302.7058...` (begin-of-period
  discount factor).
- `PMT(0.05, 10, 0, -10000)` -> `-795.046...` (savings target sign
  convention; verify).

## Edge cases
- Very small `rate` (1e-12): use stable formula; avoid cancellation in
  `(1+r)^n - 1` (exp/log form or series).

## Open questions
- Exact error for `nper = 0` (`#DIV/0!` vs `#NUM!`).
- Whether `type` accepts any nonzero as begin (expected yes) and how
  text `type` coerces.
