# SEARCH

`SEARCH(find_text, within_text, [start_num])` — like FIND but
case-insensitive and supports wildcards.

## Arguments
- Same as FIND: `find_text`, `within_text`, optional `start_num`.

## Behavior
- Case-insensitive match (ASCII case folding at minimum; Unicode
  folding scope in Open questions).
- Wildcards: `?` matches any single character, `*` matches any sequence
  (including empty). `~?`, `~*`, `~~` escape the wildcards.
- Returns 1-based position of first match at/after `start_num`;
  `#VALUE!` if none or `start_num` invalid.

## Edge cases
- `SEARCH("e","Statements")` -> `1` (case-insensitive).
- `SEARCH("b*n","banana")` -> `1`.
- `SEARCH("~?","a?b")` -> `2`.

## Open questions
- Unicode case folding (e.g. German `ß` vs `SS`, Turkish `i`/`İ`) —
  decide between simple Unicode lowercase folding and locale-aware.
- Whether `*` may match across the whole string only greedily or if
  any-match semantics suffice (no observable difference expected; verify
  with fixture).
