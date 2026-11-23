# IMLOG10

`IMLOG10(inumber)` — returns the base-10 logarithm (principal value)
of a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `log10(z) = IMLN(z) / ln(10) = (ln r + iθ) / ln 10`, principal
  branch `θ ∈ (−π, π]`.
- Returns **Text** `"a+bi"`.
- `inumber = 0` -> `#NUM!`.

## Errors
- Unparsable complex text -> `#NUM!`.
- `inumber = 0` -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.
- Negative reals are legal (principal complex log), unlike
  `LOG10(-1)` -> `#NUM!`.

## Examples
- `IMLOG10("100")` -> `"2"`
- `IMLOG10("10")` -> `"1"`
- `IMLOG10("3+4i")` -> `"0.698970004336019+0.402719196273373i"`
  (log10(5) + i·atan2(4,3)/ln10)
- `IMLOG10("0")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex `ln` shared with
  `IMLN`.

## Open questions
- Output formatting/precision; `j`-suffix handling.
- Blank handling; array spill.
