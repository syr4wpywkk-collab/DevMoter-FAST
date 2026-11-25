# ASINH

`ASINH(number)` — returns the inverse hyperbolic sine of `number`.

## Arguments
- `number`: numeric scalar, direct coercion. Any real number.

## Semantics
- `ASINH(x) = LN(x + SQRT(x^2 + 1))`; odd function,
  `ASINH(0)` -> `0`, `ASINH(-2.5)` -> -1.6472311463710958.

## Coercion
- Same scalar rules as `ACOS` (blank -> 0). Errors propagate.

## Errors
- `#VALUE!` on failed coercion only; no domain restriction.

## Examples
| Formula | Result |
|---|---|
| `=ASINH(-2.5)` | -1.6472311463710958 |
| `=ASINH(10)` | 2.99822295029797 |
| `=ASINH(0)` | 0 |

## Compatibility
- All Excel versions. Inverse of `SINH`.

## Open questions
- None.
