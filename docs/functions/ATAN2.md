# ATAN2

`ATAN2(x_num, y_num)` — returns the arctangent of the point
`(x_num, y_num)`, i.e. the angle between the positive x-axis and the
ray from the origin to the point, in `[-PI, PI]`.

## Arguments
- `x_num`: x-coordinate. **Argument order is x first, y second** —
  the opposite of C/Python `atan2(y, x)` and a common porting bug.
- `y_num`: y-coordinate.
- Both required, direct scalar coercion.

## Semantics
- `ATAN2(1,1)` -> `PI/4`; `ATAN2(-1,1)` -> `3*PI/4`;
  `ATAN2(1,-1)` -> `-PI/4`; `ATAN2(-1,-1)` -> `-3*PI/4`.
- `ATAN2(0, -1)` -> `PI` (negative x-axis).
- Implement as `f64::atan2(y, x)` — note the swapped order.

## Coercion
- Same scalar rules as `ACOS`; blanks coerce to 0. Errors propagate.

## Errors
- `ATAN2(0, 0)` -> `#DIV/0!` (Excel documents this; IEEE `atan2(0,0)`
  would return 0 — the engine must special-case it).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ATAN2(1,1)` | 0.7853981633974483 |
| `=ATAN2(-1,-1)` | -2.356194490192345 |
| `=ATAN2(0,0)` | #DIV/0! |

## Compatibility
- All Excel versions.

## Open questions
- None.
