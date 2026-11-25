# IMEXP

`IMEXP(inumber)` — returns the exponential `e^z` of a complex
number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `e^(x+yi) = e^x·(cos(y) + i·sin(y))`.
- Returns **Text** `"a+bi"`.

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMEXP("1+i")` -> `"1.46869393991589+2.28735528717884i"`
  (e·(cos1 + i·sin1))
- `IMEXP("0")` -> `"1"`
- `IMEXP("1")` -> `"2.71828182845905"` (e)
- `IMEXP("3.14159265358979i")` -> `"-1"` (e^(iπ) ≈ −1; imaginary
  residue ~1.2e-16 — fixture should assert magnitude, not exact
  string)
- `IMEXP("bad")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; `f64::exp`, `sin`, `cos`.

## Open questions
- Output formatting/precision (near-zero components like the real
  part of e^(iπ) — Excel emits `"1.22464679914735E-16-1i"` style
  results; exact rendering rule needed).
- `j`-suffix preservation; blank handling; array spill.
