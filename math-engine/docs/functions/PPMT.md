# PPMT

`PPMT(rate, per, nper, pv, [fv], [type])` — principal portion of the
payment in period `per` for a constant-payment loan.

## Arguments
- `rate`: required; per-period rate.
- `per`: required; which period, integer in `1..nper` (truncated? —
  Excel requires `1 <= per <= nper`; fractional `per` is truncated —
  confirm).
- `nper`: required; total periods.
- `pv`: required; present value.
- `fv`: optional, default `0`.
- `type`: optional, default `0`; `1` = beginning-of-period payments.

## Semantics
- `PPMT(rate, per, nper, pv, fv, type) = PMT(...) - IPMT(...)` where
  `IPMT` is the interest portion of period `per`:
  - `type = 0`: interest for period k on balance after k-1 payments.
  - `type = 1`: period 1 interest = 0; period k>1 interest = rate *
    balance after k-2 payments (payment at start of k-1 reduces it).
- Sign conventions match `PMT` (principal portion negative for a loan
  with positive `pv`).

## Coercion
- Direct-scalar; errors propagate.

## Errors
- `per` outside `1..nper` -> `#NUM!`.
- `per <= 0` or `per > nper` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `PPMT(0.1, 1, 10, 10000)` -> `-627.4539...` (PMT ≈ -1627.454,
  period-1 interest = 1000; verify final digits).
- `PPMT(0.1, 10, 10, 10000)` -> `-1479.50...` (final period repays the
  outstanding balance |PMT|/1.1 = 1479.50; verify digits).
- `PPMT(0.005, 1, 36, 10000)` -> `-254.219...` (PMT -304.219 minus
  period-1 interest 50).
- `PPMT(0.1, 0, 10, 10000)` -> `#NUM!`.
- `PPMT(0.1, 1, 10, 10000, 0, 1)` -> `-1627.45` (first payment all
  principal under begin-of-period — verify).

## Open questions
- Fractional `per` truncation vs rounding vs error.
- `per` exactly `nper` under `type=1` interest formula edge.
