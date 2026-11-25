# SORTBY

`SORTBY(array, by_array1, [sort_order1], [by_array2, sort_order2], ...)` — sorts `array` by the values of one or more parallel key arrays. Dynamic-array function.

## Arguments
- `array`: required; range/array to reorder.
- `by_arrayN`: required; a single column or row aligned with the sort
  dimension of `array` (height = `array` height to sort rows; width =
  `array` width to sort columns).
- `sort_orderN`: optional; `1` ascending (default), `-1` descending.

## Semantics
- Sorts rows when `by_arrayN` is a column vector of matching height;
  sorts columns when it's a row vector of matching width. (Both-dims
  ambiguity with a 1-column/1-row `array` — confirm precedence.)
- Keys: numbers sort numerically, text sorts case-insensitively
  (lexicographic, locale-ordered? confirm), booleans after text?
  Standard Excel order: numbers < text < FALSE < TRUE; blanks always
  go last in both directions? — For `SORTBY`, blanks sort last in
  ascending and first in descending? **SPEC-OPEN** (Excel `SORT` puts
  blanks last regardless of direction).
- Errors in key arrays sort last in ascending order? (Excel sorts
  error cells after other values — confirm ordering `#N/A` etc.)
- Stable sort? Not guaranteed — document as unspecified (confirm).
- Mixed key types follow the standard type ordering; multiple key
  arrays break ties left to right.

## Errors
- `by_arrayN` not a single row/column or dimension mismatch ->
  `#VALUE!`.
- `sort_orderN` other than `1`/`-1` -> `#VALUE!`.
- `by_arrayN` containing multiple columns/rows -> `#VALUE!`.

## Examples
- `SORTBY({3,1;1,2;2,3}, {3;1;2})` -> `{1,2;2,3;3,1}`
- `SORTBY({"b",1;"a",2}, {"b";"a"})` -> `{"a",2;"b",1}`
- `SORTBY({1,5;2,6}, {2;1}, -1)` -> `{2,6;1,5}`
- `SORTBY({1;2;3}, {2;1;3}, 1, {9;8;7}, -1)` -> sorts by first key
  asc, ties by second desc.
- `SORTBY({1,2;3,4}, {1;2;3})` -> `#VALUE!` (key length mismatch)

## Compatibility notes
- Excel 365 / Excel 2021 (dynamic arrays). Not in Excel 2019.

## Open questions
- Blank/error ordering within keys, ascending and descending.
- Stability guarantee.
- Type ordering details (numbers vs text-numbers like `"2"`).
