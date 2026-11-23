# CLEAN

`CLEAN(text)` — removes non-printable characters from `text`.
Designed for stripping the first 32 characters of the 7-bit ASCII
set (codes 0..31) plus code 127 in the Unicode implementation.

## Arguments
- `text`: required; coerced to text (number -> text-of-number,
  boolean -> `"TRUE"`/`"FALSE"`, blank -> `""`, error propagates).

## Semantics
- Removes characters with codes `0..31`. In current Excel (Unicode),
  `CLEAN` also removes `127` and the Unicode non-printing set
  `129`, `141`, `143`, `144`, `157` (legacy CP1252 non-printables) —
  **confirm** exact code list against reference.
- Does NOT remove the regular space (32) or non-breaking space (160);
  combine with `TRIM` for spaces.

## Errors
- Error in `text` propagates.
- No other error conditions.

## Examples
- `CLEAN(CHAR(9)&"abc")` -> `"abc"` (tab removed)
- `CLEAN("a"&CHAR(10)&"b")` -> `"ab"` (line feed removed)
- `CLEAN("abc")` -> `"abc"`
- `CLEAN(CHAR(127)&"x")` -> `"x"` (confirm 127 removal)
- `CLEAN(123)` -> `"123"` (number coerced first; nothing removed)

## Compatibility
- All Excel versions. The set of removed codes differs between the
  legacy ANSI implementation (codes 0..31 of the code page) and the
  modern Unicode implementation (adds 127 + select CP1252 high codes).

## Open questions
- Exact removal set under the Unicode implementation (0..31, 127, and
  which of 129/141/143/144/157).
- Whether `CLEAN` removes other Unicode non-characters/control
  categories (Cc/Cf beyond the listed set) — expected no, verify.
