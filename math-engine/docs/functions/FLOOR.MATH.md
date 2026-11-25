# FLOOR.MATH

`FLOOR.MATH(number, [significance], [mode])` — rounds `number` down to
the nearest multiple of `significance`.

v2 plan §2 (045): sign rules for `significance`/`mode`, rounding
direction for negatives. Mirror of `CEILING.MATH`.

## Arguments
- `number`: numeric scalar, direct coercion.
- `significance`: optional, default `1`; sign ignored (absolute value
  used — confirm, mirroring `CEILING.MATH`).
- `mode`: optional, default `0`. For negative `number` only: nonzero
  `mode` rounds toward positive infinity (away from zero, i.e. toward
  zero in magnitude? — see below); zero `mode` rounds toward negative
  infinity.

## Behavior
- `FLOOR.MATH(4.3)` -> 4; `FLOOR.MATH(4.3, 0.5)` -> 4.
- `FLOOR.MATH(-4.3)` -> -5 (default: toward -inf).
- `FLOOR.MATH(-4.3, 1, 1)` -> -4 (mode nonzero: toward +inf / toward
  zero).
- This is the exact mirror of `CEILING.MATH` with the `mode` senses
  swapped.

## Errors
- Coercion failures -> `#VALUE!`; error inputs propagate.
- `significance` = 0 -> 0 for positive numbers (confirm negatives).

## Edge cases
- Exact multiples unchanged.
- `FLOOR.MATH(-8, 3)` -> -9 (default) vs `FLOOR.MATH(-8, 3, -1)` -> -6.
- Boundary floating-point multiple detection shared with
  `CEILING.MATH` via a common helper (`common/number.rs`).

## Open questions
- Same as `CEILING.MATH`: significance-0 negatives, `mode` coercion.
