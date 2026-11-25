# IMSEC

`IMSEC(inumber)` — returns the secant of a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `sec(z) = 1 / cos(z)`; `cos(x+yi) = cos(x)cosh(y) − i·sin(x)sinh(y)`.
- Returns **Text** `"a+bi"`.
- Wherever `cos(z) = 0` (real `z = π/2 + kπ`): `#NUM!` or
  `#DIV/0!` (**SPEC-OPEN**, same as `IMCSC`).

## Errors
- Unparsable complex text -> `#NUM!`.
- `cos(inumber) = 0` -> `#NUM!`/`#DIV/0!` (confirm).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSEC("1+i")` -> `"0.498337030555187+0.591083841721045i"`
- `IMSEC("0")` -> `"1"`
- `IMSEC("1")` -> `"1.85081571768093"` (sec(1) = 1/cos(1))
- `IMSEC("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter and complex-division
  primitive (shared with `IMDIV`).

## Open questions
- Error value when `cos(z) = 0`.
- Output formatting/precision; `j`-suffix preservation.
- Blank handling; array spill.
