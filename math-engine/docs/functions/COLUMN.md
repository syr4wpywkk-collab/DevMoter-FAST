# COLUMN

`COLUMN([reference])` — returns the column number(s) of a reference.

v2 plan §2 (054): column number; return shape for multi-column
references. Mirror of `ROW`.

## Arguments
- `reference`: optional; omitted -> column of the calling cell.

## Behavior
- `COLUMN(C3)` -> 3; `COLUMN()` in B3 -> 2.
- `COLUMN(A1:C1)` -> Excel `{1,2,3}` under spill; single value or
  `#VALUE!` pending dynamic arrays — **open**, same policy as `ROW`.

## Errors
- Invalid reference -> `#REF!`; non-reference argument -> `#VALUE!`
  (confirm).

## Edge cases
- Columns beyond Z (e.g. `COLUMN(AA10)` -> 27) — column-index
  arithmetic, no letter parsing needed at eval time.
- Cross-sheet references allowed.

## Open questions
- Multi-cell reference return shape pending spill support.
- Caller-context plumbing (shared with `ROW`, `CELL`-style funcs).
