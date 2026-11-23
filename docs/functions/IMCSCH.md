# IMCSCH

`IMCSCH(inumber)` — returns the hyperbolic cosecant of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `csch(z) = 1 / sinh(z)`. For `z = x+yi`, `sinh(z) =
  sinh(x)cos(y) + i·cosh(x)sin(y)`; `csch` is its complex reciprocal.
- Returns **Text** `"a+bi"`.
- `z = 0` (sinh = 0): `#NUM!` or `#DIV/0!` (**SPEC-OPEN**).

## Errors
- Unparsable complex text -> `#NUM!`.
- `sinh(inumber) = 0` -> `#NUM!`/`#DIV/0!` (confirm).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCSCH("1+i")` -> `"0.303931001628427-0.621518017170428i"`
- `IMCSCH("1")` -> `"0.850918128239322"` (1/sinh(1))
- `IMCSCH("-1")` -> `"-0.850918128239322"`
- `IMCSCH("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter and complex-division
  primitive.

## Open questions
- Error value when `sinh(z) = 0`.
- Output formatting/precision; `j`-suffix preservation.
- Blank argument handling; array spill behavior.
