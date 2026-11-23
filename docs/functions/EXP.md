# EXP

`EXP(number)` — e raised to `number`.

## Arguments
- `number`: required; direct-scalar coercion (numeric text/booleans
  coerce, other text `#VALUE!`, blank -> 0 -> result `1`).

## Computation
- `f64::exp`.
- `EXP(0)` -> `1`; `EXP(1)` -> `2.718281828459045` (Excel's displayed
  precision — fixtures use tolerance).

## Errors
- Overflow (result > `f64::MAX`, ~`number > 709.78`) -> `#NUM!`
  (Excel returns `#NUM!` — confirm; do **not** return `inf`).
- Underflow to `0` is **not** an error (Excel returns `0`? — confirm;
  `EXP(-746)` underflows).
- Errors propagate; non-coercible text -> `#VALUE!`.

## Edge cases
- `EXP(-inf)` cannot occur (no inf input), but huge negatives -> `0`.
- Accuracy near `EXP(1)` — match Excel to documented tolerance.

## Open questions
- Error kind on overflow (`#NUM!` expected).
- Underflow result (`0` expected).
