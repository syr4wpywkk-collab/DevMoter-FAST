# DEC2HEX

`DEC2HEX(number, [places])` — converts a decimal integer to hexadecimal
text.

## Arguments
- `number`: required; integer in `[-549,755,813,888, 549,755,813,887]`
  (±2^39). Fractions truncated toward zero.
- `places`: optional; minimum output width (max 10), zero-padded;
  ignored for negatives.

## Semantics
- Returns uppercase hex **text**. Negatives render as 10-char two's
  complement (`"-1"` -> `"FFFFFFFFFF"`).

## Errors
- `number` out of `[-2^39, 2^39-1]` -> `#NUM!`.
- Invalid `places` (negative, > 10, too small for result) -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `DEC2HEX(100, 4)` = `"0064"`
- `DEC2HEX(-54)` = `"FFFFFFFFCA"`
- `DEC2HEX(255)` = `"FF"`
- `DEC2HEX(28)` = `"1C"`
- `DEC2HEX(549755813888)` -> `#NUM!`

## Compatibility notes
- Excel 2003+ (ATP earlier). `BASE` covers wider ranges with radix arg.

## Open questions
- `places` non-integer truncation (confirm).
- Numeric text coercion.
