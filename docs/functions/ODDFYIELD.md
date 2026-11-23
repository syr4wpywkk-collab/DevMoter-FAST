# ODDFYIELD

`ODDFYIELD(settlement, maturity, issue, first_coupon, rate, pr,
redemption, frequency, [basis])` — yield of a security with an odd
first coupon period.

## Arguments
- Same date set as `ODDFPRICE`: `maturity > first_coupon >
  settlement > issue`.
- `rate`: coupon rate, `>= 0`.
- `pr`: price per $100 face, `> 0`.
- `redemption`: redemption per $100.
- `frequency`: {1,2,4}; `basis`: optional 0..4 default 0.

## Semantics
- Inverse of `ODDFPRICE`: iteratively solve `ODDFPRICE(yld) = pr`.
  Excel iterates (Newton-based) over the same formula tree —
  convergence ~100 iterations; document tolerance.
- No closed form exists.

## Errors
- As `ODDFPRICE` (`#NUM!` for ordering/rate/pr<=0/frequency/basis;
  `#VALUE!` coercion; `#NUM!` on non-convergence).

## Examples
- `ODDFYIELD(39600, 40124, 39441, 39715, 0.0785, 113.60, 100, 2, 0)`
  -> `0.0625` (inverse of the ODDFPRICE doc example; verify).
- `ODDFYIELD(...)` round-trip fixture: compute pr from ODDFPRICE then
  recover yld within tolerance.
- `ODDFYIELD(45000, 46000, 44000, 44900, -0.05, 100, 100, 2)` ->
  `#NUM!`.

## Engine requirements
- Same shared utilities as `ODDFPRICE` plus an iterative solver.

## Open questions
- Solver tolerance/iteration cap (shared question with `YIELD`,
  `RATE`, `XIRR`).
- Whether iteration starts at a fixed guess.
