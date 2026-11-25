# ACOTH

`ACOTH(number)` — returns the inverse hyperbolic cotangent of `number`.

## Arguments
- `number`: numeric scalar, direct coercion. Must satisfy
  `ABS(number) > 1`.

## Semantics
- `ACOTH(x) = 0.5 * LN((x+1)/(x-1))` for `|x| > 1`.
- `ACOTH(6)` -> 0.1682361183106068; `ACOTH(-6)` ->
  -0.1682361183106068 (odd function).
- Large `|x|` -> approaches 0.

## Coercion
- Same scalar rules as `ACOS` (blank -> 0 -> `#NUM!` domain error).
- Error inputs propagate.

## Errors
- `ABS(number) <= 1` -> `#NUM!` (includes -1, 0, 1).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ACOTH(6)` | 0.1682361183106068 |
| `=ACOTH(-1.1)` | -1.5222612188617113 |
| `=ACOTH(1)` | #NUM! |

## Compatibility
- **Excel 2013+** (`_xlfn.ACOTH` when saved for older versions).
  Inverse of `COTH`.

## Open questions
- None.
