# QUOTIENT

`QUOTIENT(numerator, denominator)` — returns the integer portion of a
division, discarding the remainder.

## Arguments
- `numerator`, `denominator`: numeric scalars, coerced per the
  direct-argument model.

## Behavior
- Truncates toward zero (unlike `INT`, which floors):
  `QUOTIENT(5,2)` -> 2; `QUOTIENT(-5,2)` -> -2;
  `QUOTIENT(4.5,3.1)` -> 1; `QUOTIENT(-10,3)` -> -3.
- Use `MOD` for the remainder.

## Errors
- `denominator` = 0 -> `#DIV/0!`.
- Coercion failures -> `#VALUE!`; errors propagate.

## Compatibility
- Excel 2003 and earlier required Analysis ToolPak; native since
  Excel 2007.

## Edge cases
- Non-finite result on huge/overflowing quotient -> `#NUM!`.

## Open questions
- Behavior with non-finite numerator (document `#NUM!` policy).
