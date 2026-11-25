# ODD

`ODD(number)` — rounds `number` up, away from zero, to the nearest odd
integer.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.
  Non-integers have their fraction part dropped only in the sense of
  rounding up to next odd; the result is always an integer.

## Behavior
- `ODD(1.5)` -> 3; `ODD(3)` -> 3; `ODD(2)` -> 3.
- `ODD(-1)` -> -1; `ODD(-2)` -> -3; `ODD(0)` -> 1.
- Definition: smallest odd integer >= |number|, sign of number.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- No `#NUM!` domain restriction.

## Edge cases
- Very large magnitudes: if `number` rounds past f64 integer
  precision, document behavior (no error expected).
- `ODD(TRUE)` -> 1 (boolean coerces to 1, already odd).

## Open questions
- None.
