# IMCOT

`IMCOT(inumber)` — returns the cotangent of a complex number, as
text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `cot(z) = cos(z) / sin(z) = 1 / tan(z)`. For `z = x+yi`:
  `cot(z) = (sin(2x) − i·sinh(2y)) / (cosh(2y) − cos(2x))`.
- Returns **Text** `"a+bi"`.
- `z = 0` (cot undefined, sin(0)=0): Excel returns `#NUM!`
  (confirm — may be `#DIV/0!`; flag).

## Errors
- Unparsable complex text -> `#NUM!`.
- `inumber = 0+0i` -> `#NUM!` or `#DIV/0!` (**SPEC-OPEN**).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCOT("1+i")` -> `"0.217621561854403-0.868014142895925i"`
- `IMCOT("0.785398163397448")` -> `"1"` (cot(π/4) = 1, approx)
- `IMCOT("i")` -> `"-1.31303528549933i"` (−i·coth(1))
- `IMCOT("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter. Implementation should reuse
  the `IMCOS`/`IMSIN` pair or a complex-division primitive shared
  with `IMDIV`.

## Open questions
- Error value for `z = 0` (`#NUM!` vs `#DIV/0!`).
- Output formatting/precision; `j`-suffix preservation.
- Blank argument handling; array spill behavior.
