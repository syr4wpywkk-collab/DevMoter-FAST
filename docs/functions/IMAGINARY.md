# IMAGINARY

`IMAGINARY(inumber)` — returns the imaginary coefficient of a complex
number stored as text.

## Arguments
- `inumber`: required. A complex number in Excel text form
  `"x+yi"` / `"x+yj"` (see "Complex number format" below). A real
  numeric value is treated as a complex number with imaginary part 0.

## Complex number format
- Text of the form `a+bi`, `a-bi`, `a+bj`, `a-bj`, where `a` and `b`
  are optional decimal coefficients (`"3+4i"`, `"-2-5j"`, `"4i"`,
  `"i"` == `0+1i`, `"3"` == `3+0i`). Suffix must be lowercase `i` or
  `j` (uppercase `I`/`J` is **not** accepted per MS docs — confirm).
- A real `Number` argument is coerced to `n+0i`.
- Text that does not parse -> `#NUM!`.
- Boolean argument -> `#VALUE!`.
- Blank argument: treated as `0+0i` or `#NUM!` — **SPEC-OPEN**
  (confirm against reference).

## Semantics
- Returns a `Number`: the imaginary coefficient `b` of `a+bi`.
- For a pure-real input (`"3"`, `3`, `"3+0i"`) returns `0`.
- Scalar in -> scalar out. Array/spill: Excel spills per element when
  given an array of complex strings (dynamic-array Excel); under a
  scalar engine, array input is **Open question** (see below).

## Errors
- Unparsable complex text -> `#NUM!`.
- Boolean -> `#VALUE!`.
- Error input propagates.

## Examples
- `IMAGINARY("3+4i")` -> `4`
- `IMAGINARY("5-2j")` -> `-2`
- `IMAGINARY("7")` -> `0`
- `IMAGINARY("-i")` -> `-1`
- `IMAGINARY("abc")` -> `#NUM!`
- `IMAGINARY(TRUE)` -> `#VALUE!`

## Compatibility
- Available since early Excel (Analysis ToolPak function; built-in
  since Excel 2007). Complex values are **text**, not a native type.

## Engine requirements
- Complex numbers exist only as text strings; a shared
  parse/format helper for `a±bi`/`a±bj` is required by all `IM*`
  functions (one implementation, reused everywhere).

## Open questions
- Whether a Blank argument/coerced empty string yields `0+0i` or
  `#NUM!`.
- Uppercase `I`/`J` suffix acceptance (`"3+4I"` — expected `#NUM!`).
- Whitespace inside the complex string (`"3 + 4i"`).
- Array input spill behavior under the current engine.
