# SORT

`SORT(array, [sort_index], [sort_order], [by_col])` — returns a sorted copy of `array` as a spilled array.

## Arguments
- `array`: range or array, any shape.
- `sort_index`: optional, default `1` — 1-based index of the sort-key
  column (or row when `by_col` is TRUE).
- `sort_order`: optional, `1` ascending (default) or `-1` descending.
- `by_col`: optional boolean; FALSE (default) sorts rows, TRUE sorts
  columns. Only single-key sorting is in scope (multi-key array form of
  `sort_index`/`sort_order` is a later phase — Open question).

## Result shape & spill
- Output has the **same shape** as `array` and spills into a
  rectangular range from the formula cell.
- `#SPILL!` when the target range contains any non-blank cell; nothing
  is written on obstruction. Spill-resize rules as `FILTER.md`.
- Sort must be **stable**: rows/columns equal on the key keep their
  original relative order (plan §7 specifies the algorithm work).

## Comparison rules
Within one key column, Excel orders types in a fixed hierarchy;
adopted baseline (**SPEC-OPEN**, verify against Excel/LibreOffice):
- ascending: numbers < text (case-insensitive) < FALSE < TRUE < errors;
  blanks always sort **last regardless of direction**.
- Text ordering is case-insensitive with locale-independent code-point
  tie-breaking (confirm; Excel uses a linguistic collation).
- Mixed-type keys never error; they order by the type hierarchy.
- Error cells in the key sort by error kind? Excel sorts errors to the
  end consistently — confirm exact ordering.

## Errors
- `sort_index` out of range or 0 -> `#VALUE!`.
- `sort_order` other than `±1` -> `#VALUE!`.
- Non-coercible `sort_index`/`sort_order` -> `#VALUE!`.
- Errors inside `array` do not abort the sort; they sort per the
  hierarchy and appear in the output.

## Edge cases
- 1xN or Nx1 arrays.
- All-equal keys -> output identical to input (stability).
- Descending keeps blanks last (Excel behavior — confirm).
- `by_col=TRUE` transposes the axis, not the data.

## Open questions
- Full type-ordering table incl. error ordering.
- Text collation: case-insensitive + which tie-break.
- Multi-key `sort_index`/`sort_order` arrays (Excel allows) — phase in.
