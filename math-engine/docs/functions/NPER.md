# NPER

`NPER(rate, pmt, pv, [fv], [type])` — number of periods for an
investment/loan with constant payment `pmt`, periodic rate `rate`,
present value `pv`, target future value `fv`, and payment timing
`type`.

## Arguments
- `rate`: required; interest rate per period (not annualized unless
  the caller divides). May be negative in principle; typical domain
  `rate > -1`.
- `pmt`: required; payment made each period (constant).
- `pv`: required; present value (lump sum at t=0).
- `fv`: optional, default `0`.
- `type`: optional, default `0`; `0` = payments at end of period,
  nonzero/`TRUE` = beginning of period. Truncated to integer? Excel
  treats any nonzero as 1 — confirm exact coercion.

## Semantics
- Solves `pv*(1+r)^n + pmt*(1+r*type)*((1+r)^n - 1)/r + fv = 0` for `n`.
- Closed form: `n = log( (pmt*(1+r*type) - r*fv) / (pv*r + pmt*(1+r*type)) ) / log(1+r)`
  (equivalent rearrangements exist; implement in a numerically stable form).
- `rate = 0` degenerate: `n = -(pv + fv) / pmt`.
- Result may be fractional (Excel does not round up).
- Excel computes NPER **iteratively** in some paths — confirm whether
  closed form or Newton iteration; differences only visible near
  degenerate inputs.

## Coercion
- All args: direct-scalar coercion (numeric text accepted, booleans
  coerced when passed directly, blanks -> `0`? — blank in required
  position: confirm, likely `0`). Errors propagate.

## Errors
- Non-numeric arg -> `#VALUE!`.
- No real solution (log of nonpositive argument, e.g. signs make the
  equation unsolvable) -> `#NUM!`.
- `rate <= -1` with nonzero other terms -> `#NUM!` (confirm).
- `pmt = 0` and `rate = 0` with `pv + fv != 0` -> `#NUM!`
  (division by zero in degenerate form; Excel yields `#NUM!`? confirm
  vs `#DIV/0!`).

## Examples
- `NPER(0.005, -200, 10000)` -> `53.8988...` (months to pay off 10,000
  at 0.5%/mo paying 200/mo).
- `NPER(0.06/12, -150, -5000, 0, 0)` -> `36.5559...`.
- `NPER(0, -100, 1200)` -> `12`.
- `NPER(0.005, -50, 10000)` -> `#NUM!` (payment < interest accrual).

## Open questions
- Closed-form vs iterative implementation; must match Excel's
  convergence domain.
- Exact error class for the degenerate `rate=0, pmt=0` case.
- Blank/boolean handling in required scalar positions.
