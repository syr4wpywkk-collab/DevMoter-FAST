# DEC2BIN

`DEC2BIN(number, [places])` — converts a decimal integer to binary
text.

## Arguments
- `number`: required; decimal integer in `[-512, 511]`. Non-integers
  are truncated toward zero.
- `places`: optional; minimum character count, zero-padded; ignored
  for negative results.

## Semantics
- Returns **text**. Negatives render as 10-character two's complement
  (`"-1"` -> `"1111111111"`).

## Errors
- `number < -512` or `number > 511` -> `#NUM!`.
- `places < 0`, `places > 10`, or too small for positive result ->
  `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `DEC2BIN(9, 4)` = `"1001"`
- `DEC2BIN(-100)` = `"1110011100"`
- `DEC2BIN(511)` = `"111111111"`
- `DEC2BIN(5, 2)` -> `#NUM!` (`"101"` needs 3 chars)
- `DEC2BIN(512)` -> `#NUM!`
- `DEC2BIN(4.9)` = `"100"` (truncated)

## Compatibility notes
- Excel 2003+ (ATP earlier). `BASE` supersedes for larger ranges.

## Open questions
- Truncation direction for negative fractions (`-4.9` -> `-4`?) —
  confirm.
- Blank `places` behavior.
