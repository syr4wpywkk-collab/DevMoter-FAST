# DEC2OCT

`DEC2OCT(number, [places])` — converts a decimal integer to octal text.

## Arguments
- `number`: required; integer in `[-536,870,912, 536,870,911]`
  (±2^29). Fractions truncated toward zero.
- `places`: optional; min output width (max 10); ignored for negatives.

## Semantics
- Returns **text**. Negatives render as 10-char two's-complement octal
  (`"-1"` -> `"7777777777"`).

## Errors
- `number` out of range -> `#NUM!`.
- Invalid `places` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `DEC2OCT(58, 3)` = `"072"`
- `DEC2OCT(-100)` = `"7777777634"`
- `DEC2OCT(8)` = `"10"`
- `DEC2OCT(536870912)` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Same coercion/truncation questions as `DEC2BIN`/`DEC2HEX`.
