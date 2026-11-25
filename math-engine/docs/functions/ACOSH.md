# ACOSH

`ACOSH(number)` — returns the inverse hyperbolic cosine of `number`.

## Arguments
- `number`: numeric scalar, direct coercion. Must be `>= 1`.

## Semantics
- `ACOSH(1)` -> `0`; result grows monotonically
  (`ACOSH(10)` -> 2.993222846126381).
- Equivalent to `LN(number + SQRT(number^2 - 1))` within floating-point
  tolerance; implement via `f64::acosh` or the stable closed form.

## Coercion
- Direct args: numeric text, booleans, and blank references coerce as
  for `ACOS` (blank -> 0, which then fails the domain check -> `#NUM!`).
- Error inputs propagate.

## Errors
- `number < 1` -> `#NUM!`.
- `#VALUE!` on failed coercion.

## Examples
| Formula | Result |
|---|---|
| `=ACOSH(1)` | 0 |
| `=ACOSH(10)` | 2.993222846126381 |
| `=ACOSH(0.5)` | #NUM! |

## Compatibility
- All Excel versions. Inverse of `COSH`.

## Open questions
- None.
