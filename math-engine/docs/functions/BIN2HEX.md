# BIN2HEX

`BIN2HEX(number, [places])` — converts a binary string to hexadecimal
text.

## Arguments
- `number`: required; binary string, max 10 characters, two's-complement
  for 10-char inputs starting with `1`.
- `places`: optional; minimum number of hex characters in the result,
  padded with leading zeros. Truncated to integer. Default: smallest
  width needed.

## Semantics
- Returns **text** (uppercase hex, e.g. `"F"`, `"01A0"`).
- Negative results are rendered as 10-character two's-complement hex
  (`"FFFFFFFFFF"`) and ignore `places`.

## Coercion
- Same `number` coercion rules as `BIN2DEC`.
- Non-numeric `places` text -> `#VALUE!` (confirm `#NUM!` vs `#VALUE!`).

## Errors
- `number` invalid or > 10 chars -> `#NUM!`.
- `places < 0` or `places > 10` -> `#NUM!`.
- `places` too small for a *positive* result -> `#NUM!`
  (`BIN2HEX("1111111111", 3)` on a positive value that needs 4 digits).

## Examples
- `BIN2HEX("11111011", 4)` = `"00FB"`
- `BIN2HEX("1110")` = `"E"`
- `BIN2HEX("1111111111")` = `"FFFFFFFFFF"`
- `BIN2HEX("1001", 2)` = `"09"`
- `BIN2HEX("102")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier). Output is a string, not a number — chained
  arithmetic requires `HEX2DEC` or coercion.

## Open questions
- Exact error kind for bad `places` (`#NUM!` documented).
- Case of output — always uppercase (confirm).
