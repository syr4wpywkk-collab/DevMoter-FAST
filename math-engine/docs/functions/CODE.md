# CODE

`CODE(text)` — returns the numeric code of the **first** character of
`text`. Legacy function; modern replacement is `UNICODE`.

## Arguments
- `text`: required; coerced to text. Only the first character is
  inspected.

## Semantics
- Same codepage dependence as `CHAR` (its inverse): under Western
  ANSI, `CODE("A")` -> `65`; characters `128..255` map through the
  system ANSI code page.
- For a portable engine, adopt the same fixed mapping chosen for
  `CHAR` (see `CHAR.md`); document the deviation.
- Empty text (`""`) -> `#VALUE!` (Excel returns `#VALUE!`; confirm).

## Errors
- `#VALUE!` for empty input or error propagation.
- `CODE` of a character with no mapping in the chosen codepage is
  unspecified — under fixed CP1252, unmapped Unicode chars return
  `63` (`?`) in Excel's ANSI builds; **SPEC-OPEN** whether to emulate
  that or return `#VALUE!`.

## Examples
- `CODE("A")` -> `65`
- `CODE("Alphabet")` -> `65` (first char only)
- `CODE("")` -> `#VALUE!`
- `CODE("é")` -> `233` under CP1252
- `CODE(123)` -> `49` (`"123"` -> code of `"1"`)

## Compatibility
- All Excel versions. For codepoint-correct behavior use `UNICODE`;
  `CODE` differs for characters outside the fixed codepage.

## Open questions
- Fixed codepage choice (shared with `CHAR`).
- Behavior for unmapped Unicode characters (`#VALUE!` vs `63`).
- Empty-string behavior: confirm `#VALUE!`.
