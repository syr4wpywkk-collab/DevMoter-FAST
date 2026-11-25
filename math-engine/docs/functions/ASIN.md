# ASIN

`ASIN(number)` — returns the arcsine (inverse sine) of `number` in
radians, in the range `[-PI/2, PI/2]`.

## Arguments
- `number`: numeric scalar, direct coercion. Must be in `[-1, 1]`.

## Semantics
- `ASIN(0)` -> `0`; `ASIN(1)` -> `PI/2`; `ASIN(-1)` -> `-PI/2`.
- `DEGREES(ASIN(-0.5))` -> `-30`.

## Coercion
- Direct args: numeric text, booleans, blank reference -> 0.
  Non-numeric text -> `#VALUE!`. Errors propagate.

## Errors
- `number < -1` or `number > 1` -> `#NUM!`.

## Examples
| Formula | Result |
|---|---|
| `=ASIN(-0.5)` | -0.5235987755982989 |
| `=ASIN(1)` | 1.5707963267948966 |
| `=ASIN(1.5)` | #NUM! |

## Compatibility
- All Excel versions. Inverse of `SIN`; see `ASINH` for hyperbolic.

## Open questions
- None.
