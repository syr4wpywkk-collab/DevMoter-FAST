# ASC

`ASC(text)` — converts full-width (double-byte) characters in `text`
to their half-width (single-byte) equivalents. Primarily relevant for
DBCS locales (Japanese, Chinese, Korean).

## Arguments
- `text`: required; coerced to text per the shared text-coercion rules
  (number -> text-of-number, boolean -> `"TRUE"`/`"FALSE"`, blank ->
  `""`, error propagates).

## Semantics
- Each full-width character is mapped to its half-width equivalent:
  - Full-width ASCII variants U+FF01..U+FF5E -> U+0021..U+007E.
  - Full-width space U+3000 -> U+0020.
  - Half-width katakana handling: Excel's `ASC` maps **full-width**
    katakana (U+30A0 block) to **half-width** katakana (U+FF61..U+FF9F),
    preserving voicing marks where the combination exists —
    **SPEC-OPEN** (document exact table from a reference locale).
- Characters with no half-width equivalent are returned unchanged.
- In non-DBCS locale configuration Excel still performs the full-width
  ASCII/space mapping (confirm).

## Engine requirements
- A fixed full->half mapping table must ship with the engine (std
  only, no external crates); katakana pair/dakuten handling needs a
  small composed/decomposed table.

## Errors
- Error in `text` propagates.
- No other error conditions; unconvertible text is returned as-is.

## Examples
- `ASC("ＡＢＣ")` -> `"ABC"`
- `ASC("１２３")` -> `"123"`
- `ASC("　")` (full-width space) -> `" "`
- `ASC("カタカナ")` -> `"ｶﾀｶﾅ"` (confirm half-width katakana output)
- `ASC("abc")` -> `"abc"`

## Compatibility
- Legacy function available in all Excel versions; behavior depends on
  the workbook/locale. See `DBCS.md` (inverse direction) and `JIS`
  (not in scope).

## Open questions
- Exact katakana mapping table including dakuten/handakuten pairs
  (`ガ` -> `ｶﾞ` decomposed pair, or single half-width?).
- Whether mapping is locale-gated in Excel or unconditional.
- Whether `ASC` on numbers formats the number before mapping
  (`ASC(１２３)` vs `ASC("１２３")`).
