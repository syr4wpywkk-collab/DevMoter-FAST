# XMATCH

`XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])` — returns the 1-based position of `lookup_value` within `lookup_array`.

## Arguments
- `lookup_value`: required scalar.
- `lookup_array`: required; single row or column (vector).
- `match_mode`: optional; `0` exact (default — unlike `MATCH` whose
  default is `1`), `-1` exact or next smaller, `1` exact or next
  larger, `2` wildcard.
- `search_mode`: optional; `1` first-to-last (default), `-1`
  last-to-first, `2` binary ascending, `-2` binary descending.

## Semantics
- Returns `Number` — the index (1-based) of the matching element, not
  the value.
- Exact match: numbers by value; text case-insensitive (confirm);
  booleans match booleans; a text `"5"` does not match number `5`.
- Wildcard mode: `*` (any run), `?` (one char), `~` escapes — same
  grammar as `SUMIF.md`.
- Approximate `-1`/`1`: like `MATCH` — on no exact hit returns nearest
  smaller/larger position; documented well-defined even on unsorted
  data? (confirm; `MATCH` assumes sort order — `XMATCH` docs say
  approximate works regardless of sort order by scanning).
- Binary modes assume sorted data; wrong order -> unspecified result.
- Multi-cell `lookup_array` that is 2-D (both dims > 1) -> `#N/A`
  (confirm; Excel docs say array must be a vector — some builds return
  `#VALUE!`).

## Errors
- No match -> `#N/A`.
- Invalid `match_mode`/`search_mode` -> `#VALUE!`.
- Error elements in `lookup_array` are skipped for non-matching
  positions; a position that "would match" an error cell — propagates?
  (confirm).

## Examples
- `XMATCH("b", {"a","b","c"})` -> `2`
- `XMATCH(4, {1,3,5,7}, 1)` -> `3` (next larger is `5` at position 3)
- `XMATCH(4, {1,3,5,7}, -1)` -> `2` (next smaller is `3`)
- `XMATCH("b*", {"apple","banana"}, 2)` -> `2`
- `XMATCH(9, {1,3,5}, -1)` -> `3`; `XMATCH(9, {1,3,5}, 1)` -> `#N/A`
- `XMATCH("b", {"a","b","b"}, , -1)` -> `3` (last-to-first)

## Compatibility notes
- Excel 365 / Excel 2021. Default match differs from `MATCH` (exact
  vs approximate) — call out in porting notes.

## Open questions
- Case sensitivity of exact text match (expected insensitive).
- 2-D `lookup_array` error type.
- Approximate behavior on unsorted data (scan vs binary assumptions).
