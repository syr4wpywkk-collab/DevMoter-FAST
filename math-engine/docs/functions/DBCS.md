# DBCS

`DBCS(text)` — converts half-width (single-byte) letters in `text` to
their full-width (double-byte) equivalents. Inverse of `ASC`;
equivalent to the Japanese `JIS` function.

## Arguments
- `text`: required; coerced to text (number -> text-of-number,
  boolean -> `"TRUE"`/`"FALSE"`, blank -> `""`, error propagates).

## Semantics
- Half-width ASCII U+0021..U+007E -> full-width U+FF01..U+FF5E.
- Half-width space U+0020 -> full-width space U+3000 (confirm;
  documented Excel behavior converts spaces).
- Half-width katakana U+FF61..U+FF9F -> full-width katakana; decomposed
  dakuten pairs (e.g. `ｶ`+`ﾞ`) combine into the precomposed full-width
  form (`ガ`) — **SPEC-OPEN**, record exact composition rules.
- Characters without a full-width equivalent pass through unchanged.
- No-op for input already full-width or non-convertible.

## Engine requirements
- A fixed half->full mapping table plus dakuten composition table
  (std only, ships with engine).

## Errors
- Error in `text` propagates.

## Examples
- `DBCS("ABC")` -> `"ＡＢＣ"`
- `DBCS("123")` -> `"１２３"`
- `DBCS(" ")` -> `"　"` (full-width space)
- `DBCS("ｶﾀｶﾅ")` -> `"カタカナ"`
- `DBCS("ＡＢＣ")` -> `"ＡＢＣ"` (unchanged)

## Compatibility
- All Excel versions; meaningful mainly for East-Asian text. Round-
  trip property: `ASC(DBCS(x))`/`DBCS(ASC(x))` should be identity on
  the convertible subset — fixture-test this.

## Open questions
- Half-width katakana composition rules (voiced/semi-voiced pairs,
  long-vowel mark `ｰ` -> `ー`).
- Whether space conversion is unconditional (32 -> U+3000) or
  locale-gated.
- Punctuation edge cases (half-width `,` `.` `()` mapping).
