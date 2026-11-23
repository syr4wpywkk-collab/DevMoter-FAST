# SIGN

`SIGN(number)` — returns 1, 0, or -1 according to the sign of
`number`.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.

## Behavior
- `SIGN(10)` -> 1; `SIGN(4-4)` -> 0; `SIGN(-0.00001)` -> -1.
- `SIGN(-0.0)` -> 0 (negative zero is 0).
- `SIGN(TRUE)` -> 1; `SIGN("3")` -> 1.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.

## Edge cases
- `-0.0` input must return 0, not -0.
- NaN cannot occur in the Value model.

## Open questions
- None.
