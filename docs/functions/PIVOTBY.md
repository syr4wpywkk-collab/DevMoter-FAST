# PIVOTBY

`PIVOTBY(row_fields, col_fields, values, function, [field_headers], [row_total_depth], [row_sort_order], [col_total_depth], [col_sort_order], [filter_array], [field_relationship])` — two-dimensional pivot-style aggregation. Dynamic-array function (Excel 365, 2024+).

## Arguments
- `row_fields`: required; key column(s), row-aligned with `values`.
- `col_fields`: required; key column(s) whose distinct values become
  result columns.
- `values`: required; array/range to aggregate.
- `function`: required; same vocabulary as `GROUPBY` (see
  `GROUPBY.md`): text name or ETA lambda. `PERCENTOF` variants
  (`0` parent-total, `1` row-parent, `2` col-parent, `3` grand
  total — confirm indexing) apply within the pivot.
- `field_headers`: optional; `0`–`3` as in `GROUPBY`.
- `row_total_depth`, `col_total_depth`: optional; `0` none, `1` grand,
  `2` grand + subtotals, negative = totals on top/left.
- `row_sort_order`, `col_sort_order`: optional; sort key indexes
  (negative = descending) into the respective axes.
- `filter_array`: optional; boolean row mask.
- `field_relationship`: optional; `0` hierarchy, `1` table.

## Semantics
- Produces a cross-tab: distinct `row_fields` keys as rows, distinct
  `col_fields` keys as columns, aggregated `values` in the body,
  optional totals. Spills.
- Missing (row,col) combinations produce empty cells — Excel emits
  blank or `0`? (**SPEC-OPEN**; believed blank).
- Same aggregation semantics and key-grouping rules as `GROUPBY`.

## Errors
- Row-count mismatches among `row_fields`/`col_fields`/`values`/
  `filter_array` -> `#VALUE!`.
- Unknown function name -> `#VALUE!`/`#CALC!` (confirm).
- Out-of-range enum arguments -> `#VALUE!`.

## Examples
- `PIVOTBY({"a";"a";"b";"b"}, {"x";"y";"x";"y"}, {1;2;3;4}, "SUM")`
  -> `{"a",1,2;"b",3,4}` with `x`,`y` as column headers (header row
  emitted per `field_headers`; layout shown is the logical matrix —
  **confirm exact header row/col placement**).
- `PIVOTBY({"a";"b"}, {"x";"y"}, {5;7}, "SUM", 0, 1, , 1)` ->
  adds grand-total row and column.
- `PIVOTBY({"a";"a"}, {"x";"x"}, {1;2}, "AVERAGE")` -> `{"a",1.5}`
- `PIVOTBY({"a";"b"}, {"x";"x"}, {1;2}, "SUM", 0,0,,0,,{FALSE;TRUE})`
  -> `{"b",2}` (filter keeps second row).

## Compatibility notes
- Excel 365 (2024). Signature is newer than `GROUPBY`'s and may still
  evolve — pin a build before implementing.

## Open questions
- Blank vs `0` for absent row/col intersections.
- Header layout and total labels (localization).
- `PERCENTOF` argument encoding.
- Ordering when multiple `row_fields`/`col_fields` columns are used.
