# HEX2OCT

`HEX2OCT(number, [places])` — converts a hexadecimal string to octal
text.

## Arguments
- `number`: required; hex string, max 10 chars; negative via
  two's-complement. Resulting value must be within octal range
  `[-536,870,912, 536,870,911]`.
- `places`: optional; min octal width (max 10); ignored for negatives.

## Semantics
- Returns **text**. Values outside the octal domain -> `#NUM!`
  (`"FFE0000000"` range — check boundary; any hex value whose decimal
  equivalent is outside ±2^29 errors).

## Errors
- Invalid hex / > 10 chars -> `#NUM!`.
- Value out of octal range -> `#NUM!`.
- Invalid `places` -> `#NUM!`.

## Examples
- `HEX2OCT("F", 3)` = `"017"`
- `HEX2OCT("3B4E")` = `"35516"`
- `HEX2OCT("FFFFFFFF00")` = `"7777777400"` (`-256`)
- `HEX2OCT("1ZZ")` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Exact out-of-range boundary (confirm `±2^29` applies to the converted
  value).
- `places` on negative results ignored (confirm).
