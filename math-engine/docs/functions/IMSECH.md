# IMSECH

`IMSECH(inumber)` — returns the hyperbolic secant of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `sech(z) = 1 / cosh(z)`; `cosh(x+yi) = cosh(x)cos(y) +
  i·sinh(x)sin(y)`.
- Returns **Text** `"a+bi"`.
- `cosh(z) = 0` (pure imaginary `z = (π/2 + kπ)i`): `#NUM!` or
  `#DIV/0!` (**SPEC-OPEN**).

## Errors
- Unparsable complex text -> `#NUM!`.
- `cosh(inumber) = 0` -> `#NUM!`/`#DIV/0!` (confirm).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSECH("1+i")` -> `"0.498337030555187-0.591083841721045i"`
- `IMSECH("0")` -> `"1"`
- `IMSECH("1")` -> `"0.648054273663885"` (sech(1) = 1/cosh(1))
- `IMSECH("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter and complex-division
  primitive.

## Open questions
- Error value when `cosh(z) = 0`.
- Output formatting/precision; `j`-suffix preservation.
- Blank handling; array spill.
