# TEXTSPLIT

`TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with])` —
splits text into a 2-D spilled array by column and/or row delimiters.

## Arguments
- `text`: required; coerced to text (scalar only — a range does not
  map element-wise in Excel; **confirm**).
- `col_delimiter`: required text (or array of delimiters — Excel
  accepts a constant array `{";",","}`). Empty `""` splits into
  individual characters (documented).
- `row_delimiter`: optional; same rules; splits rows.
- `ignore_empty`: optional `FALSE` default; `TRUE` drops empty
  segments (produced by adjacent/leading/trailing delimiters).
- `match_mode`: optional `0` case-sensitive (default), `1`
  case-insensitive.
- `pad_with`: optional; value used to fill ragged rows when
  `row_delimiter` produces uneven column counts. Default `#N/A`.

## Semantics
- Result is a dynamic array (spill). Column split first, then row
  split within each column segment? — actual order: Excel builds the
  grid by splitting on `row_delimiter` into rows and `col_delimiter`
  into columns simultaneously — **SPEC-OPEN** for delimiter-
  precedence details with array delimiters.
- Multiple delimiters in one arg: treated as alternatives (each is a
  delimiter), NOT multi-delimiter sequences.
- `ignore_empty=TRUE` can remove whole empty rows/columns? —
  removes empty *elements*; structural effect SPEC-OPEN.
- Ragged grid padded with `pad_with`.

## Errors
- `#VALUE!` invalid `ignore_empty`/`match_mode`; `pad_with` of
  multi-cell array (must be scalar — confirm).
- `#N/A` appears as *pad value* (not an error result) by default.
- Errors in `text` propagate.

## Examples
- `TEXTSPLIT("a,b,c",",")` -> `{"a","b","c"}` (1x3 spill)
- `TEXTSPLIT("a,b;c,d",";",",")` — col `;`, row `,`:
  rows `"a,b"`/`"c,d"`? No — arg order is col first: with
  `col=","` `row=";"`, `TEXTSPLIT("a,b;c,d",",",";")` ->
  `{"a","b";"c","d"}` (2x2)
- `TEXTSPLIT("a;;b",";", ,TRUE)` -> `{"a","b"}` (empty dropped)
- `TEXTSPLIT("a-b,c;d",{"-",";",","})` — delimiter array splits on
  any (verify layout)
- `TEXTSPLIT("a,b;c",";")` -> `{"a,b","c"}` col-split only.

## Engine requirements
- Dynamic-array spill (plan §6 Phase 4) is a hard prerequisite.

## Compatibility
- Microsoft 365 / Excel 2021+. Not in Excel 2019- (`#NAME?`).

## Open questions
- Exact grid construction with both delimiters + delimiter arrays
  (precedence/order).
- `ignore_empty` interaction with `pad_with` and ragged rows.
- Whether `text` may be an array (expected scalar-only).
