# IMPOWER

`IMPOWER(inumber, number)` — returns a complex number raised to a
power, as text: `inumber ^ number`.

## Arguments
- `inumber`: required. Base, complex number as text or a real number
  (see `IMAGINARY.md` "Complex number format").
- `number`: required. Exponent — may be an integer, fraction, or
  complex number expressed as text (per MS docs `number` can itself
  be complex; confirm limits).

## Semantics
- Computed via polar form: `(r·e^(iθ))^n = r^n · e^(inθ)` using the
  principal `θ ∈ (−π, π]`. Equivalent: `exp(n · IMLN(z))`.
- Returns **Text** `"a+bi"`.
- `0^0` and `0` raised to a negative power -> `#NUM!` (confirm —
  possibly `#DIV/0!` for negative powers of 0).

## Errors
- Either argument unparsable -> `#NUM!`.
- `inumber = 0` with `number <= 0` -> `#NUM!`/`#DIV/0!`
  (**SPEC-OPEN**).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMPOWER("2+3i",3)` -> `"-46+9i"` ((2+3i)³)
- `IMPOWER("2",10)` -> `"1024"`
- `IMPOWER("0+1i",2)` -> `"-1"` (i² = −1; floating residue expected
  — assert magnitude in fixtures)
- `IMPOWER("4",0.5)` -> `"2"` (principal square root)
- `IMPOWER("bad",2)` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex `ln`/`exp` shared
  with `IMLN`/`IMEXP`.

## Open questions
- Whether `number` accepts complex exponents in all Excel versions
  (MS docs show numeric exponents; complex-in-exponent support is
  documented but sparsely tested — flag).
- Error for `0^0` / `0` to negative power.
- Multi-valued roots: Excel returns the principal value only.
- `j`-suffix handling; blank handling; array spill.
