# IMCOS

`IMCOS(inumber)` — returns the cosine of a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `cos(x+yi) = cos(x)·cosh(y) − i·sin(x)·sinh(y)`.
- Returns **Text** `"a+bi"` (suffix letter follows the input
  convention — confirm `j` preservation).
- For pure-real input `"x"`, equals `COS(x)` formatted as complex
  text.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCOS("1+i")` -> `"0.833730025131149-0.988897705762865i"`
  (cos(1)cosh(1) − i·sin(1)sinh(1))
- `IMCOS("0")` -> `"1"`
- `IMCOS("3.14159265358979")` -> `"-1"` (cos(π), approx)
- `IMCOS("i")` -> `"1.54308063481524"` (cosh(1))
- `IMCOS("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013 (not in Excel 2007/2010). Result is text.

## Engine requirements
- Shared complex-text parser/formatter. `f64` `sin`/`cos`/`sinh`/
  `cosh` suffice; document output precision/formatting rules.

## Open questions
- Exact output formatting/precision (Excel emits up to ~15
  significant digits; exact decimal rendering rule needed for golden
  fixtures).
- `j`-suffix preservation in output.
- Blank argument handling; array spill behavior.
