# IMCONJUGATE

`IMCONJUGATE(inumber)` — returns the complex conjugate `x - yi` of a
complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- Returns **Text**: the conjugate `x - yi`, formatted with the same
  suffix letter (`i` or `j`) as the input.
- Input `"a+bi"` -> `"a-bi"`; `"a-bi"` -> `"a+bi"`; pure real `"a"`
  -> `"a"`.
- Suffix preservation: `"3+4j"` -> `"3-4j"` (confirm: Excel preserves
  the `j` suffix).

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMCONJUGATE("3+4i")` -> `"3-4i"`
- `IMCONJUGATE("3-4i")` -> `"3+4i"`
- `IMCONJUGATE("5")` -> `"5"`
- `IMCONJUGATE("2j")` -> `"-2j"`
- `IMCONJUGATE("xx")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is a
  text complex number, not a numeric type.

## Engine requirements
- Shared complex-text parser **and formatter**; output formatting
  rules (when to print `a-bi` vs `a+-bi`, decimal representation,
  suffix letter) must be fixed once for all `IM*` functions that
  return text — see Open questions.

## Open questions
- Exact output formatting: coefficient display (`"3-4i"` vs
  `"3+-4i"`), omitting `0` parts (`"5"` vs `"5+0i"`; Excel shows
  `"5"` — confirm), and `j`-suffix preservation.
- Blank argument handling; array spill behavior.
