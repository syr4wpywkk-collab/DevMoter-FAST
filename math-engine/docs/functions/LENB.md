# LENB

`LENB(text)` — byte-oriented variant of `LEN`: returns the **byte**
length of `text` where double-byte characters count as 2.

## Arguments
- `text`: required scalar; coerced to text (number -> text-of-number
  then counted, boolean -> `"TRUE"`/`"FALSE"`, blank -> `0`, error
  propagates).

## Semantics
- ASCII/single-byte chars count 1; double-byte chars count 2:
  `LENB("東京都")` -> `6`; `LENB("abc")` -> `3`; `LENB("a東")` -> `3`.
- Non-DBCS configuration: identical to `LEN`.
- Same character-model open question as `LEN` regarding what counts
  as one character for surrogate pairs — byte model decides.

## Errors
- Error argument propagates.
- No negative/error results possible.

## Examples
- `LENB("東京都")` -> `6`
- `LENB("abc")` -> `3`
- `LENB("")` -> `0`
- `LENB("A1東")` -> `4`

## Engine requirements
- Shared byte-width table (see `FINDB.md`).

## Compatibility
- All Excel versions with DBCS; degrades to `LEN` otherwise.

## Open questions
- Byte model (CP932 vs UTF-16 units vs East-Asian width) — must agree
  with all other `*B` functions on the same table.
- Width of characters outside the DBCS set (e.g. emoji, Cyrillic):
  treated as single or double? Under CP932 semantics unmapped -> 1;
  under East-Asian-width they may be 2 — fix in spec before fixtures.
