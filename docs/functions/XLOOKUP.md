# XLOOKUP

`XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])` — searches `lookup_array` for `lookup_value` and returns the corresponding element of `return_array`.

Plan §6 Phase 3: implement exact match first; `if_not_found`, search
direction, approximate match, wildcards, and 2-D return are added
incrementally.

## Arguments
- `lookup_value`: required scalar.
- `lookup_array`: required 1-D range or array (row or column vector).
- `return_array`: required; same length as `lookup_array` along the
  search dimension. May have additional columns/rows (2-D return is
  **phased** — see Open questions).
- `if_not_found`: optional scalar/array returned when no match; default
  `#N/A`.
- `match_mode`: optional: `0` exact (default), `-1` exact or next
  smaller, `1` exact or next larger, `2` wildcard match.
- `search_mode`: optional: `1` first-to-last (default), `-1` last-to-first,
  `2` binary search ascending, `-2` binary search descending.

## Match semantics
- Exact match (mode `0`): numbers compare by value; text compares
  **case-insensitively** (confirm; Excel is insensitive); booleans match
  booleans. A text `lookup_value` does not match a numeric cell with the
  same digits (type matters).
- Wildcard mode (`2`): `*` `?` `~` grammar identical to `SUMIF.md`.
- Approximate modes (`-1`/`1`): on no exact hit, return nearest
  smaller/larger element; behavior on unsorted data is well-defined per
  Excel (scans in order — confirm) and must be documented.
- Binary modes (`±2`) assume sorted `lookup_array`; results on unsorted
  input are unspecified — document that no validation is performed.

## Shape rules
- `lookup_array` column-vector + `return_array` column-vector of same
  height -> scalar result (or the matched row slice for wide
  `return_array`).
- Row-vector lookup mirrors with widths.
- Mismatched lengths along the search dimension -> `#VALUE!`.
- Multi-column `return_array` produces a horizontal spill **only if**
  spill support exists at implementation time; otherwise `#VALUE!` or
  first-column-only (Open question).

## Errors
- No match and no `if_not_found` -> `#N/A`.
- Error values inside `lookup_array`/`return_array`: non-matching error
  elements are skipped; a matched error element propagates (confirm).
- Invalid `match_mode`/`search_mode` -> `#VALUE!`.
- `if_not_found` may itself be an array (spills in Excel) — Open
  question under no-spill engine.

## Edge cases
- Duplicate matches: `search_mode` `1` returns first, `-1` returns last.
- Blank cells in `lookup_array` never match a non-blank lookup value;
  looking up `0` vs blank — confirm Excel semantics.
- `lookup_value` of `Blank` -> Excel matches blank cells (confirm).

## Open questions
- Case sensitivity of exact text match (expected insensitive).
- Whether 2-D `return_array`/`if_not_found` array results are supported
  before dynamic-array spill lands (plan §6 Phase 4).
- Binary-search fallback on unsorted data: document-as-unspecified vs
  linear fallback.
- Blank/empty-string lookup semantics.
