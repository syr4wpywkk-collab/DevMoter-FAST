# IMREAL

`IMREAL(inumber)` — returns the real coefficient of a complex
number stored as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- Returns a `Number`: the real coefficient `a` of `a+bi`.
- For a pure-imaginary input (`"4i"`, `"-j"`) returns `0`.
- Scalar in -> scalar out; array input spill is **Open question**
  (same as `IMAGINARY`).

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMREAL("6-9i")` -> `6`
- `IMREAL("3+4j")` -> `3`
- `IMREAL("-4i")` -> `0`
- `IMREAL(12.5)` -> `12.5`
- `IMREAL("n/a")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Companion
  of `IMAGINARY`.

## Engine requirements
- Shared complex-text parser (see `IMAGINARY.md`).

## Open questions
- Blank argument handling (`0` vs `#NUM!`).
- Uppercase suffix / embedded whitespace acceptance.
- Array input spill behavior.
