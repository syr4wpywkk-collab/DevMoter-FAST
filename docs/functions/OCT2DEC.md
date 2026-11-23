# OCT2DEC

`OCT2DEC(number)` — converts an octal number to decimal, returning
a number.

## Arguments
- `number`: required. Octal value as text or number; digits `0`–`7`
  only. May be negative (`-` prefix or 10-digit two's-complement
  form like `"7777777777"` = −1). Valid range −512..511
  (`7777000000`..`777`).

## Semantics
- Returns a `Number` (decimal integer).
- `OCT2DEC` has **no** `places` argument (unlike `OCT2BIN`/
  `OCT2HEX`); the result is a plain number.
- Two's-complement inputs map to their negative decimal value.

## Errors
- Invalid octal digits or characters -> `#NUM!`.
- Out-of-range magnitude -> `#NUM!`.
- Boolean -> `#VALUE!` (confirm; consistent with family).

## Examples
- `OCT2DEC("54")` -> `44`
- `OCT2DEC("7777777777")` -> `-1`
- `OCT2DEC("777")` -> `511`
- `OCT2DEC("7777000000")` -> `-512`
- `OCT2DEC("18")` -> `#NUM!`

## Compatibility
- Analysis ToolPak function, built-in since Excel 2007. Pair with
  `DEC2OCT`.

## Engine requirements
- None; share the base-conversion helper with `OCT2BIN`/`OCT2HEX`.

## Open questions
- Range limit details (whether 10-digit inputs with high bit clear,
  e.g. `"3777777777"`, are treated as positive 268435455 or error —
  the sign-bit boundary needs reference confirmation).
- Leading `+`/whitespace acceptance; boolean coercion.
