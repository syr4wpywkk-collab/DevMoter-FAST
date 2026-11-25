# HEX2DEC

`HEX2DEC(number)` — converts a hexadecimal string to decimal.

## Arguments
- `number`: required; hex string of at most 10 characters
  (40 bits). Case-insensitive.

## Semantics
- Returns a number in `[-549,755,813,888, 549,755,813,887]` (±2^39).
- 10-char input with high bit set is two's-complement negative:
  `"FFFFFFFFFF"` -> `-1`, `"FFFFFFFFCA"` -> `-54`,
  `"8000000000"` -> `-549755813888`.
- Shorter inputs are positive.

## Errors
- > 10 characters or non-hex characters -> `#NUM!`.

## Examples
- `HEX2DEC("A5")` = `165`
- `HEX2DEC("FFFFFFFF5B")` = `-165`
- `HEX2DEC("3DA408B9")` = `1034160313`
- `HEX2DEC("FFFFFFFFFF")` = `-1`
- `HEX2DEC("G1")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier). `DECIMAL` supersedes for wider radices.

## Open questions
- Whether a numeric argument like `10` is treated as hex `"10"` = `16`
  (expected yes — digits reinterpreted; confirm).
- Blank/boolean coercion.
