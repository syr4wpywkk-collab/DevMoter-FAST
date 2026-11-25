# IMSQRT

`IMSQRT(inumber)` — returns the principal square root of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- Principal root: `sqrt(r·e^(iθ)) = sqrt(r)·e^(iθ/2)` with
  `θ ∈ (−π, π]`; equivalently `IMPOWER(z, 0.5)`. Result always lies
  in the right half-plane (real part >= 0); for negative reals the
  result is `+i·sqrt|x|` (confirm sign vs `-i`).
- Returns **Text** `"a+bi"`.
- Negative real input is legal (unlike `SQRT(-1)` -> `#NUM!`).

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMSQRT("4")` -> `"2"`
- `IMSQRT("-4")` -> `"2i"` (or `"-2i"` — branch sign **SPEC-OPEN**)
- `IMSQRT("1+i")` -> `"1.09868411346781+0.455089860562227i"`
- `IMSQRT("i")` -> `"0.707106781186548+0.707106781186548i"`
- `IMSQRT("bad")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex `pow`/polar
  primitives shared with `IMPOWER`.

## Open questions
- Sign of the root on the negative real axis (`+2i` expected from
  the principal branch; verify against Excel).
- Output formatting/precision; `j`-suffix handling.
- Blank handling; array spill.
