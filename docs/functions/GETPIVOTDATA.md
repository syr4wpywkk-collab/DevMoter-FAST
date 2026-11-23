# GETPIVOTDATA

`GETPIVOTDATA(data_field, pivot_table, [field1, item1], [field2, item2], ...)` — extracts an aggregated value from a PivotTable report.

## Arguments
- `data_field`: required; name of the value field (text, e.g.
  `"Sales"`), or a reference to a cell containing that name.
- `pivot_table`: required; reference to any cell inside the target
  PivotTable.
- `fieldN, itemN`: optional pairs (up to 126); pivot field name and the
  item within it. Filters the returned aggregate to the intersection of
  all pairs.

## Semantics
- Returns the aggregated number/text stored at the filtered position.
- Item matching is exact (text, case-insensitive? confirm) — wildcards
  are not special (confirm).
- `itemN` may be a number or date for fields with non-text items.
- If the PivotTable has no such field/item combination -> `#REF!`.

## Errors
- `pivot_table` cell is not inside a PivotTable -> `#REF!`.
- Unknown `data_field`, `fieldN`, or `itemN` -> `#REF!`.
- `data_field` naming: must match the *display* name of the value
  field ("Sum of Sales" vs "Sales" ambiguity — **SPEC-OPEN**).

## Examples
(Assume a PivotTable at `A3` over source data with fields Region, Year,
and value field "Sales".)
- `GETPIVOTDATA("Sales", $A$3)` -> grand total, e.g. `1000`
- `GETPIVOTDATA("Sales", $A$3, "Region", "East")` -> `400`
- `GETPIVOTDATA("Sales", $A$3, "Region", "East", "Year", 2024)` -> `250`
- `GETPIVOTDATA("Sales", $A$3, "Region", "West")` when "West" is absent
  -> `#REF!`

## Engine requirements / compatibility
- Requires a live PivotTable model — outside plain value semantics.
  For a formula-only engine this function is implementable only as a
  lookup over a materialized pivot cache or stored pivot output; treat
  as **deferred** unless pivot support lands.
- Available since Excel 2002; syntax stable.

## Open questions
- Case sensitivity of field/item names.
- Behavior for calculated fields and grouped items (dates grouped by
  month etc.).
- Exact error for non-pivot reference (`#REF!` believed correct).
