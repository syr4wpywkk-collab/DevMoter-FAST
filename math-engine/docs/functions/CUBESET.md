# CUBESET

`CUBESET(connection, set_expression, [caption], [sort_order], [sort_by])` — defines a set of members/tuples from an OLAP cube.

**NOT IMPLEMENTABLE OFFLINE** — requires a live OLAP connection;
offline stub returns `#N/A`.

## Arguments
- `connection`: required; connection name.
- `set_expression`: required; MDX set expression
  (e.g. `"[Product].[Category].children"`).
- `caption`: optional; cell display text (default: the set expression
  or a generated label).
- `sort_order`: optional; `0` none (default), `1` ascending, `2`
  descending, `3` alpha-ascending, `4` alpha-descending, `5`
  natural-ascending, `6` natural-descending, `7` custom MDX (confirm
  enum values — Excel documents `SortNone=0` … `SortCustom=7`? see
  Open questions).
- `sort_by`: optional; expression or cell to sort by (ignored unless
  `sort_order` in 1–2?).

## Semantics
- Cell displays `caption`; internally holds the set, feeding
  `CUBERANKEDMEMBER`, `CUBESETCOUNT`, and `CUBEVALUE` (set slicer).
- Set itself is not spilled; `CUBESETCOUNT` gives its size and
  `CUBERANKEDMEMBER` indexes into it.

## Errors
- Unknown connection -> `#NAME?`.
- Bad set expression -> `#N/A`.
- Invalid `sort_order` -> `#VALUE!` (confirm).

## Examples
- `CUBESET("Sales","[Product].[Category].children","Categories")` ->
  cell shows `"Categories"`, holds the set.
- `CUBESET("Sales","[Date].[Year].children","Years",1,"[Measures].[Sales]")` -> set sorted by sales ascending.
- `CUBESET("Sales","[Bad].children")` -> `#N/A`

## Engine requirements
- OLAP connection + set-valued cell payloads. Stub -> `#N/A`.

## Open questions
- Exact `sort_order` enumeration on current Excel docs.
- Whether empty sets are legal (`CUBESETCOUNT` -> `0`).
