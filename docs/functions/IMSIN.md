# IMSIN

`IMSIN(inumber)` — returns the sine of a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `sin(x+yi) = sin(x)·cosh(y) + i·cos(x)·sinh(y)`.
- Returns **Text** `"a+bi"`.
- For pure-real input `"x"`, equals `SIN(x)` formatted as complex
  text.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSIN("1+i")` -> `"1.29845758141598+0.634963914784736i"`
- `IMSIN("0")` -> `"0"`
- `IMSIN("1.5707963267949")` -> `"1"` (sin(π/2), approx)
- `IMSIN("i")` -> `"1.1752011936438i"` (i·sinh(1))
- `IMSIN("bad")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007 (unlike the
  `IM*H`/secant family added in 2013). Result is text.

## Engine requirements
- Shared complex-text parser/formatter; `f64` `sin`/`cos`/`sinh`/
  `cosh`.

## Open questions
- Output formatting/precision and `j`-suffix preservation.
- Blank handling; array spill.
