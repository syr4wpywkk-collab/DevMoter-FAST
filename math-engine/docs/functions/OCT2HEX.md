# OCT2HEX

`OCT2HEX(number, [places])` — converts an octal number to
hexadecimal, returning text.

## Arguments
- `number`: required. Octal value as text or number; digits `0`–`7`.
  Negative via `-` prefix or 10-digit two's-complement form.
  Range −512..511 (`7777000000`..`777`).
- `places`: optional. Minimum hex digits, left-padded with zeros;
  truncated if non-integer; ignored for negative results (always 10
  hex characters — confirm: 30 bits implies 8 hex digits for
  negative output; Excel pads negatives to 10 chars).

## Semantics
- Returns **Text**, uppercase hex digits `0-9A-F`.
- Negative results use 10-character two's-complement hex
  (`OCT2HEX("-1")` -> `"FFFFFFFFFF"`), consistent with `DEC2HEX`.

## Errors
- Invalid octal input -> `#NUM!`; out-of-range -> `#NUM!`.
- `places` non-numeric -> `#VALUE!`; `places` <= 0 or > 10 ->
  `#NUM!`; `places` insufficient for result -> `#NUM!`.

## Examples
- `OCT2HEX("100")` -> `"40"`
- `OCT2HEX("7777777777")` -> `"FFFFFFFFFF"` (−1)
- `OCT2HEX("54",4)` -> `"002C"`
- `OCT2HEX("777")` -> `"1FF"` (511)
- `OCT2HEX("99")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Pair with
  `HEX2OCT`; output hex is uppercase, matching the `*2HEX` family.

## Engine requirements
- None; share the base-conversion helper and the `places` padding
  logic across the whole `*2*` conversion family.

## Open questions
- Negative-result field width (10 chars expected per family
  convention — confirm for octal input).
- `places` exact bounds; boolean coercion; `+`/whitespace
  acceptance.
