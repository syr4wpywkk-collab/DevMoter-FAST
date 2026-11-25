# ATAN

`ATAN(number)` — returns the arctangent of `number` in radians, in the
range `(-PI/2, PI/2)`.

## Arguments
- `number`: numeric scalar, direct coercion. Any real number.

## Semantics
- `ATAN(0)` -> `0`; `ATAN(1)` -> `PI/4` (0.7853981633974483);
  odd function: `ATAN(-1)` -> `-PI/4`.
- For a 2-argument arctangent that resolves the quadrant, use `ATAN2`.

## Coercion
- Same scalar rules as `ACOS` (blank -> 0). Errors propagate.

## Errors
- `#VALUE!` on failed coercion only.

## Examples
| Formula | Result |
|---|---|
| `=ATAN(1)` | 0.7853981633974483 |
| `=ATAN(-1)` | -0.7853981633974483 |
| `=DEGREES(ATAN(1))` | 45 |

## Compatibility
- All Excel versions. Inverse of `TAN`.

## Open questions
- None.
