# HEX2BIN

`HEX2BIN(number, [places])` — converts a hexadecimal string to binary
text.

## Arguments
- `number`: required; hex string, max 10 characters. Negative numbers
  are expressed as 10-char two's-complement hex (leading `F`s); the
  representable binary range is `[-512, 511]`.
- `places`: optional; min binary char count (max 10), zero-padded;
  ignored for negative results.

## Semantics
- Returns **text**. Hex input case-insensitive.
- Inputs mapping to values outside `[-512, 511]` -> `#NUM!`
  (`"0000000200"` = 512 -> `#NUM!`).

## Errors
- Invalid hex chars or > 10 chars -> `#NUM!`.
- Result out of `[-512, 511]` -> `#NUM!`.
- Invalid `places` -> `#NUM!`.

## Examples
- `HEX2BIN("F", 8)` = `"00001111"`
- `HEX2BIN("B7")` = `"10110111"`
- `HEX2BIN("FFFFFFFFFF")` = `"1111111111"` (`-1`)
- `HEX2BIN("3DA408B9")` -> `#NUM!` (value < -512)
- `HEX2BIN("1ZZ")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Whitespace/sign char handling (`"+F"` -> `#NUM!` expected).
- `places` truncation for fractions.
