# COT

`COT(number)` — cotangent of `number` (radians) = `1/TAN(number)`.

## Arguments
- `number`: angle in radians, required. Must not be 0 (or a multiple
  of PI — see errors).

## Semantics
- `COT(PI()/4)` -> `1` (within fp tolerance);
  `COT(0.5)` -> 1.830487721712452.
- Excel limits `|number| < 2^27` (134,217,728): outside -> `#NUM!`
  (documented).

## Coercion
- Same scalar rules as `COS`. Errors propagate.

## Errors
- `number = 0` -> `#DIV/0!`.
- `ABS(number) >= 2^27` -> `#NUM!`.
- Multiples of PI are mathematically singular but only exactly-zero
  input is documented to error — near-singular inputs return huge
  finite values (fixture PI() input: `COT(PI())` -> ~-1.2e16?

## Examples
| Formula | Result |
|---|---|
| `=COT(45*PI()/180)` | ~1 |
| `=COT(0)` | #DIV/0! |
| `=COT(2^27)` | #NUM! |

## Compatibility
- **Excel 2013+** (`_xlfn.COT`). Inverse `ACOT`.

## Open questions
- Exact behavior at `PI()` multiples (fp artifacts vs error).
- The `2^27` bound: inclusive/exclusive.
