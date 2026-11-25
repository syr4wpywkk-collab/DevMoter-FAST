# PHONETIC

**NOT IMPLEMENTABLE OFFLINE** — `PHONETIC` reads *furigana* (phonetic
guide) metadata stored on cells by Excel's East-Asian editing
features. The metadata lives in the XLSX file's phonetic-properties
records, not in cell values; the calc engine's `Value` model (plan
§3.1) has no channel for cell display metadata, and generating
furigana offline would require a Japanese morphological analyzer.

`PHONETIC(reference)` — in Excel (Japanese locale), extracts the
furigana text attached to the referenced range, concatenated.

## Arguments
- `reference`: a cell or range. Multi-cell ranges concatenate each
  cell's phonetic text (row-major — confirm).

## Semantics
- Cells without registered phonetic data contribute `""`.
- Only meaningful in files authored with Excel's furigana features;
  otherwise returns `""` — i.e. even in real Excel it usually returns
  empty for ordinary workbooks.

## Offline behavior
- Engine returns `#NAME?` (or designated unsupported-function error);
  see `DETECTLANGUAGE.md` for the parse-vs-eval policy question —
  same SPEC-OPEN applies.
- Alternative if XLSX adapter later exposes phonetic data: could be
  implemented reading `phoneticPr`/`rPh` runs — out of scope for v3.

## Examples (reference only)
- `PHONETIC(A1)` where A1 carries furigana `にほん` -> `"にほん"`
- `PHONETIC(A1)` with no phonetic data -> `""`

## Compatibility
- Excel (Japanese-language versions). Not supported in non-East-Asian
  builds meaningfully.

## Open questions
- Unsupported-function error identity (`#NAME?` vs dedicated).
- Whether the XLSX adapter may ever surface phonetic runs — if so,
  revisit implementability.
