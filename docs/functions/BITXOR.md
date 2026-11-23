# BITXOR

`BITXOR(number1, number2)` — returns the bitwise XOR of two
non-negative integers.

## Arguments / domain
Same as `BITAND`: `0 <= n < 2^48`.

## Semantics
- Scalar result: bits set where operands differ.

## Errors
- Negative or >= `2^48` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `BITXOR(5, 3)` = `6` (`101 ^ 011`)
- `BITXOR(255, 255)` = `0`
- `BITXOR(10, 12)` = `6`
- `BITXOR(1, -1)` -> `#NUM!`

## Compatibility notes
- Excel 2013+.

## Open questions
- Fractional-argument handling (truncate vs `#NUM!`) — confirm.
- Blank coercion.
