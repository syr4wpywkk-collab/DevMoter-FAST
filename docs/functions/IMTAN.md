# IMTAN

`IMTAN(inumber)` — returns the tangent of a complex number, as
text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `tan(z) = sin(z) / cos(z)`. For `z = x+yi`:
  `tan(z) = (sin(2x) + i·sinh(2y)) / (cos(2x) + cosh(2y))`.
- Returns **Text** `"a+bi"`.
- Where `cos(z) = 0` (real `z = π/2 + kπ`): result is a huge-magnitude
  value rather than a clean error (floating point); whether Excel
  errors or returns ~1e16 — **SPEC-OPEN**.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMTAN("1+i")` -> `"0.271752585319512+1.08392332733869i"`
- `IMTAN("0.785398163397448")` -> `"1"` (tan(π/4) ≈ 1)
- `IMTAN("i")` -> `"0.761594155955765i"` (i·tanh(1))
- `IMTAN("0")` -> `"0"`
- `IMTAN("bad")` -> `#NUM!`

## Compatibility
- Introduced in Excel 2013. Result is text.

## Engine requirements
- Shared complex-text parser/formatter and complex-division
  primitive (shared with `IMDIV`).

## Open questions
- Behavior exactly at `cos(z) = 0` poles.
- Output formatting/precision; `j`-suffix preservation.
- Blank handling; array spill.
