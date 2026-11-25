# IMCSC

`IMCSC(inumber)` — returns the cosecant of a complex number, as
text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `csc(z) = 1 / sin(z)`. For `z = x+yi`, `sin(z) =
  sin(x)cosh(y) + i·cos(x)sinh(y)`; `csc` is its complex reciprocal.
- Returns **Text** `"a+bi"`.
- `z = 0` (sin = 0): division by zero -> `#NUM!` or `#DIV/0!`
  (**SPEC-OPEN**, same as `IMCOT`).

## Errors
- Unparsable complex text -> `#NUM!`.
- `sin(inumber) = 0` -> `#NUM!`/`#DIV/0!` (confirm).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCSC("1+i")` -> `"0.621518017170428-0.303931001628427i"`
- `IMCSC("1.5707963267949")` -> `"1"` (csc(π/2) = 1)
- `IMCSC("i")` -> `"-0.850918128239322i"` (1/sin(i) = −i/sinh(1))
- `IMCSC("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter and complex-division
  primitive (shared with `IMDIV`).

## Open questions
- Error value when `sin(z) = 0` (`#NUM!` vs `#DIV/0!`).
- Output formatting/precision; `j`-suffix preservation.
- Blank argument handling; array spill behavior.
