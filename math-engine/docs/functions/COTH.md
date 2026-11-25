# COTH

`COTH(number)` — hyperbolic cotangent = `COSH(x)/SINH(x)` =
`1/TANH(x)`.

## Arguments
- `number`: numeric scalar, required. Must not be 0.

## Semantics
- `COTH(1)` -> 1.3130352854993315; `COTH(3)` -> 1.0049698233136892.
- As `|x|` grows, approaches ±1.

## Coercion
- Same scalar rules as `COS`. Errors propagate.

## Errors
- `number = 0` -> `#DIV/0!`.
- Overflow region does not exist (result bounded in `|result| >= 1`).

## Examples
| Formula | Result |
|---|---|
| `=COTH(2)` | 1.0373147207275482 |
| `=COTH(-1)` | -1.3130352854993315 |
| `=COTH(0)` | #DIV/0! |

## Compatibility
- **Excel 2013+** (`_xlfn.COTH`). Inverse `ACOTH`.

## Open questions
- None significant; underflow of TANH for large |x| still yields ±1.
