# IMCOSH

`IMCOSH(inumber)` — returns the hyperbolic cosine of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `cosh(x+yi) = cosh(x)·cos(y) + i·sinh(x)·sin(y)`.
- Returns **Text** `"a+bi"`.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCOSH("1+i")` -> `"0.833730025131149+0.988897705762865i"`
- `IMCOSH("0")` -> `"1"`
- `IMCOSH("1")` -> `"1.54308063481524"` (cosh(1))
- `IMCOSH("i")` -> `"0.54030230586814"` (cos(1))
- `IMCOSH("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter; `f64` hyperbolics.

## Open questions
- Output formatting/precision and `j`-suffix preservation
  (shared question across `IM*` text-returning functions).
- Blank argument handling; array spill behavior.
