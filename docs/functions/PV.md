# PV

`PV(rate, nper, pmt, [fv], [type])` — present value of an annuity with
constant payment `pmt`.

## Arguments
- `rate`: required; per-period rate.
- `nper`: required; number of periods.
- `pmt`: required; payment per period.
- `fv`: optional, default `0`; lump sum at end.
- `type`: optional, default `0`; `1` = payments at beginning.

## Semantics
- `r = 0`: `PV = -(fv + pmt*nper)`.
- `r <> 0`: `PV = -(pmt*(1 + r*type)*((1+r)^n - 1)/r + fv*(1+r)^n + ...)`
  canonical: `PV = -( fv + pmt*(1+r*type)*( ((1+r)^n - 1) / (r*(1+r)^n) ) ... )`
  — implement as `PV = -(pmt*(1+r*type)*(1-(1+r)^-n)/r + fv*(1+r)^-n)`;
  sign convention: positive payments -> negative PV (cash in/out
  convention consistent with PMT).
- `PV`, `PMT`, `FV`, `NPER`, `RATE` are mutually inverse; round-trip
  `PMT(rate, nper, PV(...))` should recover `pmt` within tolerance.

## Coercion
- Direct-scalar; errors propagate; blank optional -> default.

## Errors
- `rate = -1` (division by zero-ish) -> `#NUM!`/`#DIV/0!` — confirm.
- Non-numeric -> `#VALUE!`.
- `nper < 0`? — Excel does not error on negative nper per se; result
  is algebraic. Confirm.

## Examples
- `PV(0.005, 36, -100)` -> `3288.71...` approx (verify).
- `PV(0, 10, -100)` -> `1000`.
- `PV(0.1, 1, -100)` -> `90.9090...` (sign: positive since pmt
  negative -> PV positive? `PV(0.1,1,-100) = 90.909`; confirm sign
  convention vs Excel — Excel: `=PV(10%,1,-100)` = 90.909).
- `PV(0.08, 20, -500, 0, 1)` -> `5301.81...` approx.

## Open questions
- Error class for `rate <= -1`.
- Negative `nper` treatment.
