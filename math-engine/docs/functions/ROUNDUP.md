# ROUNDUP

`ROUNDUP(number, num_digits)` — rounds `number` away from zero to
`num_digits` decimal places.

## Arguments
- `number`: numeric scalar, coerced per the direct-argument model.
- `num_digits`: required integer; negatives round to the left of the
  decimal point; non-integers truncated.

## Behavior
- `ROUNDUP(3.2, 0)` -> 4; `ROUNDUP(76.9, 0)` -> 77;
  `ROUNDUP(3.14159, 3)` -> 3.142; `ROUNDUP(-3.14159, 1)` -> -3.2;
  `ROUNDUP(31415.92654, -2)` -> 31500.
- Always away from zero — counterpart of `ROUNDDOWN`.

## Errors
- Coercion failures -> `#VALUE!`; errors propagate.
- Extreme `num_digits`: document clamp/`#NUM!` policy (confirm).

## Edge cases
- Same floating-point caveats as `ROUND`; pin boundary fixtures
  (e.g. `ROUNDUP(2.005, 2)`).

## Open questions
- Exact half-step inputs that f64 cannot represent — measure against
  reference and document tolerance.
