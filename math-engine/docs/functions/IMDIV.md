# IMDIV

`IMDIV(inumber1, inumber2)` — returns the quotient of two complex
numbers, as text: `inumber1 / inumber2`.

## Arguments
- `inumber1`: required. Dividend, complex number as text or a real
  number (see `IMAGINARY.md` "Complex number format").
- `inumber2`: required. Divisor, same format.

## Semantics
- `(a+bi) / (c+di) = ((ac+bd) + (bc−ad)i) / (c²+d²)`.
- Returns **Text** `"x+yi"` (suffix letter: MS examples use `i`
  regardless of input; whether a `j` input yields `j` output —
  confirm, same question as all `IM*` text outputs).
- Mixed suffixes (`"1+i" / "1+j"`) are legal.

## Errors
- Either argument unparsable -> `#NUM!`.
- `inumber2 = 0+0i` -> `#NUM!` (MS docs: `#NUM!` when divisor is 0 —
  confirm vs `#DIV/0!`).
- Boolean -> `#VALUE!`. Error input propagates.

## Examples
- `IMDIV("1+2i","3+4i")` -> `"0.44+0.08i"`
- `IMDIV("-238+240i","10+24i")` -> `"5+12i"`
- `IMDIV("6","3")` -> `"2"`
- `IMDIV("1","0")` -> `#NUM!`
- `IMDIV("x","1")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Result is
  text.

## Engine requirements
- Shared complex-text parser/formatter; complex division primitive
  reused by `IMCSC`/`IMSEC`/`IMCOT`/etc.

## Open questions
- Divisor-zero error: `#NUM!` vs `#DIV/0!`.
- Output formatting/precision; `j`-suffix handling.
- Blank argument handling; array spill behavior.
