# OCT2BIN

`OCT2BIN(number, [places])` — converts an octal number to binary,
returning text.

## Arguments
- `number`: required. Octal value, given as text or number
  containing only digits `0`–`7`. May be negative: either a `-`
  prefix or a 10-digit octal two's-complement form (the 30-bit
  representation, e.g. `"7777777777"` = −1). Valid range is
  −512 (`7777000000`) through +511 (`777`).
- `places`: optional. Minimum number of binary characters in the
  result; the output is left-padded with zeros. Default: minimum
  digits needed. Non-integer `places` is truncated. Ignored for
  negative results (always 10 binary digits).

## Semantics
- Returns **Text** of `0`/`1` digits.
- Negative results use 10-character two's-complement binary
  (`OCT2BIN("-1")` -> `"1111111111"`).
- `number` given as a real `Number` is read digit-wise as octal
  (`OCT2BIN(17)` = octal `17` -> `"1111"`).

## Errors
- `number` contains digits >= 8 or other invalid characters ->
  `#NUM!`.
- `number` outside −512..511 range -> `#NUM!`.
- `places` non-numeric -> `#VALUE!`; `places` <= 0 or > 10 ->
  `#NUM!` (places > 10 needed for negative numbers — confirm exact
  bounds).
- `places` too small for the result -> `#NUM!`.

## Examples
- `OCT2BIN("3")` -> `"11"`
- `OCT2BIN("7777777777")` -> `"1111111111"` (−1 in 30-bit two's
  complement)
- `OCT2BIN("3",3)` -> `"011"`
- `OCT2BIN("17")` -> `"1111"`
- `OCT2BIN("8")` -> `#NUM!`
- `OCT2BIN("512")` -> `#NUM!` (octal 512 = 330 decimal, still in
  range — verify; range check is on octal magnitude)

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Part of the
  `BIN2*`/`DEC2*`/`HEX2*`/`OCT2*` family with identical `places`
  semantics; pair with `BIN2OCT`.

## Engine requirements
- None beyond text/number coercion already required by `DEC2*`
  family; share a base-conversion helper.

## Open questions
- Exact `places` bounds and error for places 0/negative/>10.
- Whether a leading `+` is accepted; leading/trailing whitespace.
- Two's-complement accepted only via negative sign vs also
  sign-bit-detect on 10-digit input (`"7777777777"` as negative —
  documented as -1).
- Boolean `number`/`places` coercion.
