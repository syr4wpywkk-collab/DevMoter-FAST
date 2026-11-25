# GROUPBY

`GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order], [filter_array], [field_relationship])` — groups rows by the values in `row_fields` and aggregates `values` per group. Dynamic-array function (Excel 365, 2024+; rolling out — availability may vary).

## Arguments
- `row_fields`: required; array/range of key column(s) — one or more
  columns aligned row-for-row with `values`.
- `values`: required; array/range to aggregate (same row count as
  `row_fields`).
- `function`: required; aggregation. Either a text name
  (`"SUM"`, `"AVERAGE"`, `"COUNT"`, `"COUNTA"`, `"MAX"`, `"MIN"`,
  `"PRODUCT"`, `"STDEV.S"`, `"STDEV.P"`, `"VAR.S"`, `"VAR.P"`,
  `"MEDIAN"`, `"MODE.SNGL"`, `"CONCAT"`, `"ARRAYTOTEXT"`,
  `"PERCENTOF"` — confirm full list on target build) or an `ETA`
  lambda (`LAMBDA(x,SUM(x))`).
- `field_headers`: optional; `0` no headers, `1` yes (don't show),
  `2` no but generate, `3` yes and show. Default `0`.
- `total_depth`: optional; `0` none, `1` grand total, `2` grand +
  subtotals, `-1`/`-2` totals on top. Default `0`? (confirm — Excel
  default appears to be automatic/0).
- `sort_order`: optional; column index into the result to sort by
  (negative = descending).
- `filter_array`: optional; boolean column mask, same height as
  `row_fields`, restricting input rows.
- `field_relationship`: optional; `0` hierarchy (default),
  `1` table — affects subtotal layout.

## Semantics
- Result: distinct sorted `row_fields` keys (sorted ascending by
  default? — sort governed by `sort_order`), one row per group, plus
  aggregate columns. Spills.
- Blank key cells group together; error values in keys propagate?
  (confirm).
- Aggregations apply to each column of `values` independently.
- `PERCENTOF` yields each group's share of the grand total.

## Errors
- Row-count mismatch between `row_fields`/`values`/`filter_array`
  -> `#VALUE!`.
- Unknown function name -> `#VALUE!` (or `#CALC!` — confirm).
- `field_headers`/`total_depth`/`field_relationship` out of range
  -> `#VALUE!`.

## Examples
- `GROUPBY({"a";"b";"a"}, {1;2;3}, "SUM")` -> `{"a",4;"b",2}`
- `GROUPBY({"a";"b";"a"}, {1;2;3}, "AVERAGE", 0, 1)` ->
  `{"a",2;"b",2;"Grand Total",5/3}` (total row labeled — confirm label
  text "Grand Total" is localized in real Excel; engine should fix a
  canonical string — **SPEC-OPEN**).
- `GROUPBY({"x";"y"}, {10;20}, "MAX", 0, 0, 2)` ->
  `{"y",20;"x",10}` (sort by result col 2 descending).
- `GROUPBY({"a";"b"}, {1;2}, "SUM", 0, 0, 0, {TRUE;FALSE})` ->
  `{"a",1}` (filter keeps only first row).

## Compatibility notes
- Excel 365 Insider/Current (2024). Signature details have shifted
  during rollout — pin to a documented build before implementing.

## Open questions
- Exact default sort order and `total_depth` default.
- Localization of the grand-total label.
- Whether text function names are case-insensitive.
- Behavior of `PERCENTOF` with `total_depth` = 0.
- Maximum nesting of multi-column `row_fields` keys.
