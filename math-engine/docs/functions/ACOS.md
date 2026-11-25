# ACOS

`ACOS(number)` — returns the arccosine (inverse cosine) of `number` in
radians, in the range `[0, PI]`.

## Arguments
- `number`: numeric scalar, direct coercion. Must be in `[-1, 1]`.

## Semantics
- Result is the angle whose cosine is `number`: `ACOS(1)` -> `0`,
  `ACOS(0)` -> `PI/2` (~1.5707963267948966), `ACOS(-1)` -> `PI`.
- To get degrees, wrap in `DEGREES`: `DEGREES(ACOS(-0.5))` -> `120`.

## Coercion
- Direct args: numeric text coerces (`ACOS("0.5")` -> `PI/3`),
  booleans coerce (`TRUE` -> 1, `FALSE` -> 0), blank cell reference
  -> `0`. Non-numeric text -> `#VALUE!`.
- Error inputs propagate.

## Errors
- `number < -1` or `number > 1` -> `#NUM!` (domain error).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ACOS(-0.5)` | 2.0943951023931953 (2*PI/3) |
| `=ACOS(0)` | 1.5707963267948966 |
| `=ACOS(2)` | #NUM! |

## Compatibility
- Available since earliest Excel versions; identical semantics in all
  versions. Inverse of `COS`; see also `ACOSH` (hyperbolic).

## Open questions
- None — behavior fully specified by IEEE `acos` with domain check.
