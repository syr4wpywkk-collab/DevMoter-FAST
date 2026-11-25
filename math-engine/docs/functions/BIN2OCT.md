# BIN2OCT

`BIN2OCT(number, [places])` — converts a binary string to octal text.

## Arguments
- `number`: required; binary string, max 10 characters; 10-char inputs
  starting with `1` are two's-complement negative.
- `places`: optional; minimum octal digit count, zero-padded; truncated
  to integer.

## Semantics
- Returns **text**. Negative values render as 10-digit two's-complement
  octal (`"7777777777"` for `-1`) and ignore `places`.

## Errors
- Invalid/oversized `number` -> `#NUM!`.
- `places < 0`, `places > 10`, or too small for the positive result ->
  `#NUM!`.

## Examples
- `BIN2OCT("1001", 4)` = `"0011"`
- `BIN2OCT("1111111111")` = `"7777777777"` (`-1`)
- `BIN2OCT("1100100")` = `"144"`
- `BIN2OCT("100", 2)` = `"04"`
- `BIN2OCT("2")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Boolean/blank coercion of `number`.
- `#VALUE!` vs `#NUM!` for non-numeric `places`.
