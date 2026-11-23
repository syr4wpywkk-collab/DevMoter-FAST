# IMPRODUCT

`IMPRODUCT(inumber1, [inumber2], ...)` — returns the product of 1 to
255 complex numbers, as text.

## Arguments
- `inumber1`: required. Complex number as text or real number
  (see `IMAGINARY.md` "Complex number format").
- `inumber2...`: optional, up to 255 total arguments. Each may be a
  scalar complex string, a number, or (in Excel) a range/array whose
  cells are multiplied together.

## Semantics
- Sequential complex multiplication:
  `(a+bi)(c+di) = (ac−bd) + (ad+bc)i`.
- Returns **Text** `"x+yi"`.
- Ranges: cells that are blank or contain non-numeric text are
  ignored (per MS docs: "logical values and text representations of
  numbers that you type directly into the list of arguments are
  counted" — confirm exact range rules vs `PRODUCT`).
- Mixed `i`/`j` suffixes across arguments are legal.

## Errors
- Any scalar argument unparsable -> `#NUM!`.
- Boolean scalar -> `#VALUE!` (inside a range, booleans are skipped
  — confirm against `PRODUCT` range rules).
- Error input propagates.

## Examples
- `IMPRODUCT("3+4i","5-3i")` -> `"27+11i"`
- `IMPRODUCT("1+2i",30)` -> `"30+60i"`
- `IMPRODUCT("2","3","4")` -> `"24"`
- `IMPRODUCT("i","i")` -> `"-1"`
- `IMPRODUCT("x","1")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex multiply primitive.
- Range-argument handling must mirror the project's `SUM`/`PRODUCT`
  aggregation rules for blanks/text/booleans — needs alignment.

## Open questions
- Range coercion rules: whether invalid complex text inside a range
  is skipped or errors; blank cells in ranges.
- Output formatting/precision; `j`-suffix handling.
