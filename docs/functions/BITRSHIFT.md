# BITRSHIFT

`BITRSHIFT(number, shift_amount)` — shifts `number` right by
`shift_amount` bits; negative shifts move left.

## Arguments
- `number`: required; integer in `[0, 2^48)`.
- `shift_amount`: required integer; negative = left shift.

## Semantics
- Logical right shift — no sign extension (arguments are non-negative).
  Result = `floor(number / 2^shift)` for `shift >= 0`.
- Shifting right by >= 48 always yields `0`.
- A negative `shift_amount` whose magnitude pushes the result to
  `>= 2^48` -> `#NUM!` (left-shift overflow).

## Errors
- Invalid `number` (negative, >= `2^48`) -> `#NUM!`.
- Left-shift overflow via negative `shift_amount` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `BITRSHIFT(13, 2)` = `3` (`1101 >> 2`)
- `BITRSHIFT(4, -1)` = `8`
- `BITRSHIFT(7, 3)` = `0`
- `BITRSHIFT(1, -48)` -> `#NUM!`

## Compatibility notes
- Excel 2013+.

## Open questions
- Fractional `shift_amount` truncation — confirm.
- Whether `shift` beyond 48 on the right is clamped to `0` (expected).
