# IMSUB

`IMSUB(inumber1, inumber2)` — returns the difference of two complex
numbers, as text: `inumber1 − inumber2`.

## Arguments
- `inumber1`: required. Minuend, complex number as text or a real
  number (see `IMAGINARY.md` "Complex number format").
- `inumber2`: required. Subtrahend, same format.

## Semantics
- `(a+bi) − (c+di) = (a−c) + (b−d)i`.
- Returns **Text** `"x+yi"`.
- Mixed `i`/`j` suffixes are legal.

## Errors
- Either argument unparsable -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSUB("13+4i","5+3i")` -> `"8+i"`
- `IMSUB("13","5+3i")` -> `"8-3i"`
- `IMSUB("1+2i","1+2i")` -> `"0"`
- `IMSUB("x","1")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter.

## Open questions
- Output formatting/precision; `j`-suffix handling.
- Blank argument handling; array spill.
