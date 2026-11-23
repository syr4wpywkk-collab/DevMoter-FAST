# RATE

`RATE(nper, pmt, pv, [fv], [type], [guess])` — per-period interest
rate solving the annuity equation by iteration.

## Arguments
- `nper`: required; total periods.
- `pmt`: required; payment per period.
- `pv`: required; present value.
- `fv`: optional, default `0`.
- `type`: optional, default `0`; `1` beginning-of-period.
- `guess`: optional, default `0.1`; starting point for iteration.

## Semantics
- Solves `pv*(1+r)^n + pmt*(1+r*type)*((1+r)^n - 1)/r + fv = 0` for `r`
  via Newton–Raphson (Excel iterates to ~1e-10, max ~20 iterations —
  confirm exact tolerance/iteration cap).
- Result is the **per-period** rate; annualized = `RATE(...)*12` etc.
- Rate can be negative (e.g. depreciating asset).
- Multiple roots possible; `guess` selects which is found.

## Coercion
- Direct-scalar; errors propagate.

## Errors
- Iteration fails to converge within the cap -> `#NUM!`.
- `nper <= 0` -> `#NUM!`.
- No sign change in cash flows possible solutions -> `#NUM!` when no
  real root reached.
- Non-numeric -> `#VALUE!`.

## Examples
- `RATE(48, -200, 8000)` -> `0.007701...` (~0.77%/mo; verify).
- `RATE(10, -100, 800)` -> `0.0428...` approx.
- `RATE(360, -1199.10, 200000)` -> `0.005` (typical mortgage check;
  verify to tolerance).
- `RATE(10, 100, 1000)` -> `#NUM!`? (pmt and pv same sign, fv=0 — no
  solution; Excel returns `#NUM!`, confirm).

## Edge cases
- `guess` far from root still converges for well-posed inputs.
- `pmt = 0`: `rate = (-fv/pv)^(1/n) - 1` analytically; implementation
  must handle without division-by-zero in the Newton step.

## Open questions
- Exact iteration tolerance and max-iteration count Excel uses.
- Whether Excel reports `#NUM!` or `#VALUE!` for unsolvable sign
  patterns.
