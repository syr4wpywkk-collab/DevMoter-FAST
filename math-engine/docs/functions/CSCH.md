# CSCH

`CSCH(number)` — hyperbolic cosecant = `1/SINH(number)`.

## Arguments
- `number`: numeric scalar, required. Must not be 0.

## Semantics
- `CSCH(1)` -> 0.8509181282393216; `CSCH(-1)` ->
  -0.8509181282393216 (odd function).
- Large `|x|` -> 0.

## Coercion
- Same scalar rules as `COS`. Errors propagate.

## Errors
- `number = 0` -> `#DIV/0!`.
- Very large `|x|`: `SINH` overflows to `#NUM!` or result underflows
  to 0? (**SPEC-OPEN** — Excel likely computes `1/SINH` and returns
  `#NUM!` when SINH overflows ~x>710; confirm).

## Examples
| Formula | Result |
|---|---|
| `=CSCH(1)` | 0.8509181282393216 |
| `=CSCH(2)` | 0.27572056477178325 |
| `=CSCH(0)` | #DIV/0! |

## Compatibility
- **Excel 2013+** (`_xlfn.CSCH`).

## Open questions
- Overflow-region behavior (`|x| > ~710`).
