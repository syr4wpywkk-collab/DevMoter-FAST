# FIXED

`FIXED(number, [decimals], [no_commas])` — formats a number as text
with a fixed number of decimal places.

## Arguments
- `number`: required; coerced to number (numeric text -> number,
  boolean -> 1/0, blank -> 0, error propagates). Non-coercible ->
  `#VALUE!`.
- `decimals`: optional, default `2`; truncated toward zero; negative
  rounds left of the decimal point. Excel allows a bounded range —
  **SPEC-OPEN** (documented loosely; cap at a sane limit like ±100).
- `no_commas`: optional boolean; `TRUE` suppresses the thousands
  separator. Default `FALSE` (commas shown). Coerced: nonzero number
  -> TRUE, `"TRUE"`/`"FALSE"` text -> boolean; non-coercible ->
  `#VALUE!`.

## Semantics
- Result is TEXT. Uses `,` grouping and `.` decimal point
  (en-US fixed-locale convention).
- Negative numbers get a leading `-` (unlike `DOLLAR`'s parentheses).
- Rounding: half away from zero at the displayed digit (verify ties:
  `FIXED(2.5,0)` -> `"3"` expected).

## Errors
- `#VALUE!` for non-coercible arguments.
- Extreme `decimals` beyond precision just pads zeros — no error
  expected.

## Examples
- `FIXED(1234.567)` -> `"1,234.57"`
- `FIXED(1234.567,1)` -> `"1,234.6"`
- `FIXED(1234.567,-1)` -> `"1,230"`
- `FIXED(-1234.567,1)` -> `"-1,234.6"`
- `FIXED(1234.567,1,TRUE)` -> `"1234.6"`

## Compatibility
- All Excel versions. Differs from `DOLLAR` only in the missing `$`
  and the negative sign style; differs from `TEXT` in having a fixed
  implied format.

## Open questions
- Maximum/minimum `decimals` bound.
- Tie-rounding confirmation (expected half-away-from-zero).
- Whether `decimals` > ~15 pads with zeros or repeats IEEE residue
  (expected zeros — verify).
