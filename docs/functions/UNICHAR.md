# UNICHAR

`UNICHAR(number)` — returns the Unicode character for a given
codepoint. Modern, codepage-independent replacement for `CHAR`.

## Arguments
- `number`: required; coerced to number, truncated toward zero.
  Valid range `1..1,114,111` (0x10FFFF). `0` -> `#VALUE!`;
  out-of-range or non-numeric -> `#VALUE!`.

## Semantics
- Returns the character for the Unicode codepoint, including
  supplementary-plane characters (>65535) which Excel delivers as
  surrogate pairs in its UTF-16 model; the engine's UTF-8 `String`
  holds them as one scalar value — flag the counting consequence in
  `LEN`/`LEFT` fixtures.
- Control characters (e.g. `UNICHAR(10)` = line feed) are returned
  literally.
- Noncharacters/surrogate-range inputs (`0xD800..0xDFFF`,
  `0xFFFE`, `0xFFFF`, `0x1FFFE`...): Excel returns `#VALUE!` for
  surrogates and some noncharacters — **SPEC-OPEN**; engine should
  reject unpaired-surrogate codepoints (impossible in UTF-8 anyway)
  and decide on noncharacters.

## Errors
- `#VALUE!` for `number` <= 0, > 0x10FFFF, surrogate range, or
  non-coercible. Errors propagate.

## Examples
- `UNICHAR(65)` -> `"A"`
- `UNICHAR(960)` -> `"π"`
- `UNICHAR(128512)` -> `"😀"` (supplementary plane)
- `UNICHAR(0)` -> `#VALUE!`
- `UNICHAR(55296)` -> `#VALUE!` (surrogate — confirm)

## Compatibility
- Excel 2013+. Pair with `UNICODE` (inverse). Preferred over
  `CHAR`/`CODE` for all new work because it is locale-independent.

## Open questions
- Behavior on noncharacters and unassigned codepoints (expected:
  return the codepoint as-is; Excel may differ for 0xFFFE/0xFFFF).
- Whether `UNICHAR` accepts the full scalar range or errors above
  some bound for noncharacters.
