# IMSUM

`IMSUM(inumber1, [inumber2], ...)` — returns the sum of 1 to 255
complex numbers, as text.

## Arguments
- `inumber1`: required. Complex number as text or a real number
  (see `IMAGINARY.md` "Complex number format").
- `inumber2...`: optional, up to 255 total arguments. Each may be a
  scalar, or (in Excel) a range/array summed element-wise.

## Semantics
- Component-wise addition: `Σ(a_k + b_k·i) = Σa_k + i·Σb_k`.
- Returns **Text** `"x+yi"`.
- Ranges: blank cells and non-numeric text cells are ignored
  (same open question as `IMPRODUCT` — align with `SUM` range
  rules).
- Mixed `i`/`j` suffixes are legal.

## Errors
- Any scalar argument unparsable -> `#NUM!`.
- Boolean scalar -> `#VALUE!` (in ranges, skipped — confirm).
- Error input propagates.

## Examples
- `IMSUM("3+4i","5-3i")` -> `"8+i"`
- `IMSUM("1","2i","3")` -> `"4+2i"`
- `IMSUM("5+3i")` -> `"5+3i"`
- `IMSUM("x","1")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; range-argument aggregation
  rules aligned with `SUM`/`IMPRODUCT`.

## Open questions
- Range coercion rules for blanks/text/booleans/errors inside
  ranges.
- Output formatting/precision; `j`-suffix handling.
