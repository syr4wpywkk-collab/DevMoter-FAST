# ACOT

`ACOT(number)` — returns the principal value of the arccotangent
(inverse cotangent) of `number`, in radians, in the range `(0, PI)`.

## Arguments
- `number`: numeric scalar, direct coercion. Any real number
  (including 0).

## Semantics
- `ACOT(x)` = arctangent of `1/x` reflected into `(0, PI)`:
  `ACOT(x) = PI/2 - ATAN(x)`.
- `ACOT(0)` -> `PI/2`; `ACOT(2)` -> 0.4636476090008061;
  `ACOT(-2)` -> 2.677945044588987 (in `(PI/2, PI)`).

## Coercion
- Same scalar rules as `ACOS` (numeric text, booleans, blank -> 0).
- Error inputs propagate.

## Errors
- `#VALUE!` on failed coercion only; no domain restriction.

## Examples
| Formula | Result |
|---|---|
| `=ACOT(2)` | 0.4636476090008061 |
| `=ACOT(0)` | 1.5707963267948966 |
| `=ACOT(-2)` | 2.677945044588987 |

## Compatibility
- Introduced in **Excel 2013** (file format may store as
  `_xlfn.ACOT` in earlier versions). Inverse of `COT`.

## Open questions
- None.
