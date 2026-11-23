# BITLSHIFT

`BITLSHIFT(number, shift_amount)` — shifts `number` left by
`shift_amount` bits and returns the result.

## Arguments
- `number`: required; integer in `[0, 2^48)`.
- `shift_amount`: required; integer. **Negative** values shift right
  (equivalent to `BITRSHIFT`); zero returns `number`.

## Semantics
- Result = `floor(number * 2^shift)` for `shift >= 0`; for
  `shift < 0` behaves as `BITRSHIFT(number, -shift)`.
- Shifting left until a bit passes the 48-bit boundary is fine as long
  as the *result* stays `< 2^48`; a result >= `2^48` -> `#NUM!`.

## Errors
- `number` negative, >= `2^48`, or invalid -> `#NUM!`.
- Result >= `2^48` (overflow) -> `#NUM!`.
- `shift_amount` magnitude beyond useful range: shifts of 48+ produce
  `#NUM!` for nonzero `number` (overflow) — confirm exact behavior for
  `number = 0`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `BITLSHIFT(4, 2)` = `16`
- `BITLSHIFT(4, -1)` = `2`
- `BITLSHIFT(1, 47)` = `140737488355328`
- `BITLSHIFT(3, 47)` -> `#NUM!` (`3*2^47 >= 2^48`)

## Compatibility notes
- Excel 2013+.

## Open questions
- Fractional `shift_amount` truncation — confirm.
- Exact overflow boundary conditions (result exactly `2^48` -> `#NUM!`?).
