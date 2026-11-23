# IMSINH

`IMSINH(inumber)` — returns the hyperbolic sine of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `sinh(x+yi) = sinh(x)·cos(y) + i·cosh(x)·sin(y)`.
- Returns **Text** `"a+bi"`.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSINH("1+i")` -> `"0.634963914784736+1.29845758141598i"`
- `IMSINH("0")` -> `"0"`
- `IMSINH("1")` -> `"1.1752011936438"` (sinh(1))
- `IMSINH("i")` -> `"0.841470984807897i"` (i·sin(1))
- `IMSINH("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter; `f64` hyperbolics.

## Open questions
- Output formatting/precision; `j`-suffix preservation.
- Blank handling; array spill.
