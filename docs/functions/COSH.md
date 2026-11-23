# COSH

`COSH(number)` — hyperbolic cosine of `number`.

## Arguments
- `number`: numeric scalar, direct coercion.

## Semantics
- `COSH(x) = (e^x + e^-x)/2`; even function, `COSH(0)` -> `1`,
  `COSH(4)` -> 27.308232836016487.

## Coercion
- Same scalar rules as `COS` (blank -> 0 -> result 1). Errors
  propagate.

## Errors
- Overflow: `|x| >= ~710` -> `#NUM!`? (**SPEC-OPEN** — Excel returns
  `#NUM!` on `COSH` overflow per docs pattern; confirm exact cutoff).

## Examples
| Formula | Result |
|---|---|
| `=COSH(4)` | 27.308232836016487 |
| `=COSH(0)` | 1 |
| `=COSH(-1)` | 1.5430806348152437 |

## Compatibility
- All Excel versions. Inverse `ACOSH`.

## Open questions
- Overflow cutoff and error type (`#NUM!` expected).
