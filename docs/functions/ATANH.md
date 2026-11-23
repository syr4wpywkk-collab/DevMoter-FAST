# ATANH

`ATANH(number)` — returns the inverse hyperbolic tangent of `number`.

## Arguments
- `number`: numeric scalar, direct coercion. Must satisfy
  `-1 < number < 1` (strict).

## Semantics
- `ATANH(x) = 0.5 * LN((1+x)/(1-x))`; odd function.
- `ATANH(0)` -> `0`; `ATANH(0.5)` -> 0.5493061443340549.

## Coercion
- Same scalar rules as `ACOS` (blank -> 0). Errors propagate.

## Errors
- `ABS(number) >= 1` -> `#NUM!` (includes exactly ±1).
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ATANH(0.76159416)` | ~1.000000009 |
| `=ATANH(-0.1)` | -0.10033534773107558 |
| `=ATANH(1)` | #NUM! |

## Compatibility
- All Excel versions. Inverse of `TANH`.

## Open questions
- None.
