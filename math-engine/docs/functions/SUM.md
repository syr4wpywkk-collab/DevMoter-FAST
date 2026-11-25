# SUM

`SUM(number1, [number2], ...)` — adds all numeric arguments.

## Arguments
- 1..255 arguments. Each may be a scalar, cell ref, or range.

## Type coercion
| Input | Range argument | Direct argument |
|---|---|---|
| number | summed | summed |
| numeric text (`"3"`) | ignored | coerced |
| other text | ignored | `#VALUE!` |
| boolean | ignored | coerced (TRUE=1) |
| blank | ignored | coerced to 0 |
| error | propagates | propagates |

## Errors
- `#VALUE!` for non-coercible direct text.
- Any error value in inputs propagates unchanged.

## Edge cases
- No numeric values at all -> `0` (verified in Excel).
- Mixed ranges and scalars allowed: `SUM(A1:A3,10,B1)`.
- Floating point order of accumulation should match left-to-right
  argument order so fixtures can bound the error (plan §10.3 relaxes
  associativity checks to a tolerance).

## Confirm against reference
- Exact coercion of text like `" 3 "`, `"3%"`, `"1e3"` in direct args.
- Whether an error produced *inside* an argument expression (e.g.
  `SUM(1/0)`) propagates identically to an error cell (expected: yes).
