# LCM

`LCM(number1, [number2], ...)` — least common multiple of one or more
integers.

## Arguments
- `number1..numberN`: 1–255 numeric arguments, truncated to integers.
  Ranges/arrays flattened (same open questions as `GCD` for
  non-numeric cells in ranges).

## Semantics
- `LCM(5,2)` -> `10`; `LCM(24,36)` -> `72`;
  `LCM(4,6,8)` -> `24`.
- `LCM(a,b) = ABS(a*b)/GCD(a,b)` — compute via GCD with overflow
  care (product may exceed 2^53 before division; reduce first).
- If any argument is `0`, result is `0` (documented).

## Coercion
- Same as `GCD`: numeric coercion + truncation; non-numeric direct
  args -> `#VALUE!`.

## Errors
- Any argument `< 0` after truncation -> `#NUM!`.
- Result `>= 2^53` -> `#NUM!` (documented).
- `#VALUE!` on coercion failure.

## Examples
| Formula | Result |
|---|---|
| `=LCM(5,2)` | 10 |
| `=LCM(24,36)` | 72 |
| `=LCM(5,0)` | 0 |

## Compatibility
- Excel 2007+ natively; Analysis ToolPak in Excel 2003.

## Open questions
- Range coercion rules (same as `GCD` open question).
- Whether `LCM` with a single argument returns that argument
  (`LCM(7)` -> `7` — confirm).
