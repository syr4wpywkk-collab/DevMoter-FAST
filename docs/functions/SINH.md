# SINH

`SINH(number)` — returns the hyperbolic sine of `number`.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.

## Behavior
- `SINH(1)` -> 1.1752011936438014; `SINH(-1)` -> -1.1752011936438014;
  `SINH(0)` -> 0.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- |x| large enough to overflow f64 (|x| > ~710) -> `#NUM!` (confirm;
  Excel may return `#NUM!` on overflow — shared policy with `EXP`).

## Open questions
- Overflow error kind (`#NUM!` vs infinity).
