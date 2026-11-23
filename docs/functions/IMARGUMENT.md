# IMARGUMENT

`IMARGUMENT(inumber)` — returns the argument (angle) θ of a complex
number, in radians, such that `x + yi = r·e^(iθ)` with
θ ∈ [-π, π].

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- Returns `Number` θ = `atan2(y, x)` in radians.
- Result range: `-π <= θ <= π` (MS docs state `-π < θ <= π`;
  `(-x, 0)` yields `π`, not `-π` — confirm boundary sign).
- `IMARGUMENT("0")` / `"0+0i"` -> `#DIV/0!` (documented Excel
  behavior; the argument of zero is undefined).

## Errors
- Unparsable complex text -> `#NUM!`.
- `inumber = 0+0i` -> `#DIV/0!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMARGUMENT("0+1i")` -> `1.5707963267949` (π/2)
- `IMARGUMENT("3+4i")` -> `0.92729521800161` (atan2(4,3))
- `IMARGUMENT("-1")` -> `3.1415926535898` (π)
- `IMARGUMENT("0")` -> `#DIV/0!`
- `IMARGUMENT("oops")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007.

## Engine requirements
- Shared complex-text parser (see `IMAGINARY.md`). `f64::atan2` is
  sufficient; note Excel's IEEE-754 display-precision caveats.

## Open questions
- Exact branch convention at the negative real axis (`π` vs `-π`;
  MS docs imply `(-π, π]` — verify `IMARGUMENT("-1")`).
- Blank argument handling (see `IMAGINARY.md` open question).
- Array input spill behavior.
