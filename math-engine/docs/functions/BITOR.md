# BITOR

`BITOR(number1, number2)` — returns the bitwise OR of two non-negative
integers.

## Arguments / domain
Same as `BITAND`: each argument must satisfy `0 <= n < 2^48` after
integer validation.

## Semantics
- Scalar result: bits set where *either* operand has a set bit.

## Errors
- Negative, >= `2^48`, or non-integer (per validation rule — see Open
  questions on `BITAND`) -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `BITOR(23, 10)` = `31` (`10111 | 01010`)
- `BITOR(8, 4)` = `12`
- `BITOR(0, 0)` = `0`
- `BITOR(-1, 2)` -> `#NUM!`

## Compatibility notes
- Excel 2013+.

## Open questions
- Truncation vs `#NUM!` for fractional arguments (same question as
  `BITAND`).
- Blank/`TRUE` coercion.
