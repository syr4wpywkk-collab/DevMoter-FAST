# CEILING.MATH

`CEILING.MATH(number, [significance], [mode])` — rounds `number` up to
the nearest multiple of `significance`.

v2 plan §2 (044): sign rules for `significance`/`mode`, rounding
direction for negatives.

## Arguments
- `number`: numeric scalar, direct coercion.
- `significance`: optional, default `1`. Negative significance is
  treated as its absolute value (Excel 2013+ behavior; confirm).
- `mode`: optional, default `0`. Only meaningful when `number` is
  negative: nonzero `mode` rounds toward negative infinity (away from
  zero); zero `mode` rounds toward zero (i.e. up in the mathematical
  sense).

## Behavior
- `CEILING.MATH(4.3)` -> 5; `CEILING.MATH(4.3, 0.5)` -> 4.5.
- `CEILING.MATH(-4.3)` -> -4 (default mode, toward zero).
- `CEILING.MATH(-4.3, 1, 1)` -> -5 (mode nonzero, away from zero /
  toward -inf).
- `CEILING.MATH(24.5, 6)` -> 30.

## Errors
- Coercion failures -> `#VALUE!`; error inputs propagate.
- `significance` = 0 -> Excel returns 0 for positive numbers (confirm
  negative-number behavior too).

## Edge cases
- Exact multiples unchanged: `CEILING.MATH(6, 6)` -> 6.
- Mixed signs: `CEILING.MATH(-8, 3)` -> -6 (default mode).
- Floating-point multiple detection near boundaries
  (`CEILING.MATH(0.3, 0.1)` -> 0.3, not 0.4) — use a tolerant
  multiple check; fixture it.

## Open questions
- `significance` = 0 with negative `number`: 0 vs error.
- Whether `mode` accepts any nonzero number (yes in Excel) and coercion
  of text `mode`.
