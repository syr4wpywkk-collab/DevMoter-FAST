# IMLOG2

`IMLOG2(inumber)` — returns the base-2 logarithm (principal value)
of a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `log2(z) = IMLN(z) / ln(2)`, principal branch.
- Returns **Text** `"a+bi"`.
- `inumber = 0` -> `#NUM!`.

## Errors
- Unparsable complex text -> `#NUM!`.
- `inumber = 0` -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.
- Negative reals are legal (principal complex log).

## Examples
- `IMLOG2("8")` -> `"3"`
- `IMLOG2("2")` -> `"1"`
- `IMLOG2("3+4i")` -> `"2.32192809488736+1.33780421245098i"`
  (log2(5) + i·atan2(4,3)/ln2)
- `IMLOG2("0")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex `ln` shared with
  `IMLN`.

## Open questions
- Output formatting/precision; `j`-suffix handling.
- Blank handling; array spill.
