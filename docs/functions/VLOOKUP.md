# VLOOKUP

`VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])` —
searches the first column of `table_array` and returns the value at
`col_index_num` in the matched row.

v2 plan §2 (049): exact/approximate match, table range, column index,
sorted-data assumption.

## Arguments
- `lookup_value`: scalar; error propagates.
- `table_array`: range/array; first column is searched.
- `col_index_num`: 1-based column within `table_array`; fractional
  values truncated.
- `range_lookup`: optional boolean, default TRUE (approximate).
  `0`/`FALSE` -> exact match. Numbers coerce (nonzero = TRUE).

## Behavior
- **Exact match** (`range_lookup` FALSE): linear scan of first column;
  case-insensitive for text; wildcards `*` `?` `~` are honored for
  text lookups (same rules as `MATCH` type 0 — confirm).
- **Approximate** (`range_lookup` TRUE/omitted): finds the largest
  first-column value `<= lookup_value`; assumes ascending sort —
  unsorted input gives implementation-defined (binary-search) results,
  matching Excel's quirks.
- Numeric lookup vs text cells never matches; boolean lookup does not
  match numbers (strict typing, per `MATCH`).

## Errors
- No match -> `#N/A`.
- `col_index_num` < 1 -> `#VALUE!`; > table width -> `#REF!`.
- `table_array` of a single row is allowed (result is that row);
  empty table -> `#VALUE!` or `#N/A` — confirm.
- Errors inside scanned cells propagate when encountered (confirm
  whether the scan stops at the first error or skips).

## Edge cases
- `VLOOKUP("a*", tbl, 2, FALSE)` wildcard match.
- Approximate with `lookup_value` smaller than all keys -> `#N/A`.
- Duplicate keys in approximate mode: returns the last run's boundary
  element per binary search — fixture needed.
- First column containing mixed types: comparison ordering per
  `common/compare.rs` (numbers < text < logicals, Excel order —
  confirm).

## Open questions
- Wildcard support in exact mode (yes in Excel — confirm `~` escape).
- Error-cell behavior mid-scan.
- Whether unsorted approximate-mode results are required to be
  bit-identical to Excel's binary search or just "some valid result".
