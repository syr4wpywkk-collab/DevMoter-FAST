# UNICODE

`UNICODE(text)` — returns the Unicode codepoint of the **first**
character of `text`. Modern replacement for `CODE`.

## Arguments
- `text`: required; coerced to text. Only the first character is
  inspected.

## Semantics
- `UNICODE("A")` -> `65`; `UNICODE("😀")` -> `128512` (full
  codepoint, unlike `CODE` which in Excel's UTF-16 model returns the
  high surrogate `55357`? — **verify**: Excel `UNICODE` returns the
  codepoint for a surrogate *pair* only when the pair leads the
  string; confirm behavior, fixtures must encode this).
- Empty text -> `#VALUE!` (Excel returns `#VALUE!`; confirm).

## Errors
- `#VALUE!` for empty input; errors propagate.

## Examples
- `UNICODE("A")` -> `65`
- `UNICODE("Alphabet")` -> `65`
- `UNICODE("π")` -> `960`
- `UNICODE("😀x")` -> `128512`
- `UNICODE("")` -> `#VALUE!`

## Compatibility
- Excel 2013+. Inverse of `UNICHAR` (for codepoints < 0x10000 always;
  for supplementary plane, `UNICODE(UNICHAR(n))` -> `n` — fixture).

## Open questions
- Exact first-unit semantics for supplementary-plane characters
  (codepoint vs UTF-16 lead surrogate) — verify against Excel.
- Whether a lone/invalid leading unit can occur in engine strings
  (impossible in valid UTF-8 — no issue).
