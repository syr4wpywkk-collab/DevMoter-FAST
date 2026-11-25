# IMLN

`IMLN(inumber)` — returns the natural logarithm (principal value) of
a complex number, as text.

## Arguments
- `inumber`: required. Complex number as text `"x+yi"`/`"x+yj"` or a
  real number (see `IMAGINARY.md` "Complex number format").

## Semantics
- `ln(x+yi) = ln(r) + i·θ` where `r = sqrt(x²+y²)` and
  `θ = atan2(y, x)` ∈ `(−π, π]` (principal branch).
- Returns **Text** `"a+bi"`.
- `inumber = 0+0i` -> `#NUM!` (log undefined).

## Errors
- Unparsable complex text -> `#NUM!`.
- `inumber = 0` -> `#NUM!`.
- Boolean -> `#VALUE!`. Error input propagates.
- Negative real input is **not** an error: `IMLN("-1")` ->
  `"3.14159265358979i"` (πi), unlike scalar `LN(-1)` -> `#NUM!`.

## Examples
- `IMLN("3+4i")` -> `"1.6094379124341+0.927295218001612i"`
  (ln(5) + i·atan2(4,3))
- `IMLN("1")` -> `"0"`
- `IMLN("2.71828182845905")` -> `"1"` (ln(e) ≈ 1)
- `IMLN("-1")` -> `"3.14159265358979i"`
- `IMLN("0")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; `ln`, `hypot`, `atan2`.

## Open questions
- Branch-cut convention on the negative real axis (expected `+πi`;
  confirm Excel's sign).
- Output formatting/precision; `j`-suffix handling.
- Blank handling; array spill.
