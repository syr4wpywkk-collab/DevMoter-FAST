# POWER

`POWER(number, power)` — raises `number` to `power`. Equivalent to
`number ^ power`.

v2 plan §2 (043): negative base with non-integer exponent, 0^0,
overflow, `#NUM!` all need verification.

## Arguments
- Two numeric scalars, direct-argument coercion.

## Behavior
- `POWER(2, 3)` -> 8; `POWER(4, 0.5)` -> 2.
- Negative base with integer exponent is defined:
  `POWER(-2, 3)` -> -8; `POWER(-2, 2)` -> 4.
- "Integer" test for the exponent: `exponent == trunc(exponent)` within
  f64 — near-integer exponents like `3.0000000000000004` are
  non-integer (confirm against Excel).
- `0^0` -> Excel returns 1. Match Excel.
- `0^negative` -> `#NUM!` in Excel (confirm; some engines use `#DIV/0!`).

## Errors
- Negative base with non-integer exponent -> `#NUM!`.
- Overflow (result magnitude beyond f64 finite) -> `#NUM!` (Excel).
- Coercion failures -> `#VALUE!`; error inputs propagate.

## Edge cases
- `POWER(-8, 1/3)` -> `#NUM!` (Excel does not return the real cube
  root; document this).
- `POWER(1e200, 2)` -> `#NUM!` vs `inf` — match Excel (`#NUM!`).
- `POWER(x, 0)` -> 1 for all finite x including 0 and negatives.
- Underflow to 0: `POWER(1e-200, 2)` -> 0.

## Open questions
- `0^negative`: `#NUM!` vs `#DIV/0!` in reference.
- Exact near-integer exponent tolerance, if any, in Excel.
