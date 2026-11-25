# DEGREES

`DEGREES(angle)` — converts radians to degrees.

## Arguments
- `angle`: radians, numeric scalar, required.

## Semantics
- `DEGREES(x) = x * 180 / PI`.
- `DEGREES(PI())` -> `180`; `DEGREES(PI()/2)` -> `90`;
  `DEGREES(1)` -> 57.29577951308232.

## Coercion
- Same scalar rules as `COS` (blank -> 0 -> `0`). Errors propagate.

## Errors
- `#VALUE!` on failed coercion only.

## Examples
| Formula | Result |
|---|---|
| `=DEGREES(PI())` | 180 |
| `=DEGREES(PI()/4)` | 45 |
| `=DEGREES(0)` | 0 |

## Compatibility
- All Excel versions. Inverse `RADIANS`.

## Open questions
- None.
