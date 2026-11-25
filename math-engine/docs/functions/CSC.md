# CSC

`CSC(number)` — cosecant of `number` (radians) = `1/SIN(number)`.

## Arguments
- `number`: angle in radians, required. Must not be 0; documented
  limit `|number| < 2^27`.

## Semantics
- `CSC(PI()/6)` -> `2`; `CSC(1)` -> 1.1883951057781212.

## Coercion
- Same scalar rules as `COS`. Errors propagate.

## Errors
- `number = 0` -> `#DIV/0!`.
- `ABS(number) >= 2^27` -> `#NUM!`.
- Near-multiples of PI: huge finite results expected (same open
  question as `COT`).

## Examples
| Formula | Result |
|---|---|
| `=CSC(15)` | 1.5378045614385711 |
| `=CSC(30*PI()/180)` | ~2 |
| `=CSC(0)` | #DIV/0! |

## Compatibility
- **Excel 2013+** (`_xlfn.CSC`). Inverse `ACSC` does not exist in
  Excel — note asymmetry.

## Open questions
- Singularity handling at nonzero multiples of PI.
