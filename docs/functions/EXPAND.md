# EXPAND

`EXPAND(array, rows, [columns], [pad_with])` — expands or pads `array`
to the specified dimensions. Dynamic-array function: result spills.

## Arguments
- `array`: required; range or array value.
- `rows`: required; target total row count (not "additional" rows).
  Must be >= current height, otherwise `#VALUE!`.
- `columns`: optional; target total column count. Defaults to the
  array's current width. Must be >= current width, else `#VALUE!`.
- `pad_with`: optional; value used to fill new cells. Default `#N/A`
  (Excel pads with `#N/A`, not blank — confirm on current builds).

## Semantics
- Original values keep their top-left positions; new cells appear to
  the right and below, filled with `pad_with`.
- `pad_with` may be any scalar (including error values? — confirm).
- Passing `rows`/`columns` smaller than the source is an error, not a
  crop — use `DROP`/`TAKE`/`TRIMRANGE` to shrink.

## Errors
- `rows` < current height or `columns` < current width -> `#VALUE!`.
- Non-numeric `rows`/`columns` -> `#VALUE!`.

## Examples
- `EXPAND({1,2;3,4}, 4)` -> `{1,2,#N/A,#N/A;3,4,#N/A,#N/A;#N/A,#N/A,#N/A,#N/A;#N/A,#N/A,#N/A,#N/A}`
- `EXPAND({1,2;3,4}, 2, 3, 0)` -> `{1,2,0;3,4,0}`
- `EXPAND({1,2;3,4}, 3, 3, "x")` -> `{1,2,"x";3,4,"x";"x","x","x"}`
- `EXPAND({1,2;3,4}, 1)` -> `#VALUE!`

## Compatibility notes
- Excel 365 (2023+). Not in perpetual-license Excel.

## Open questions
- Whether `pad_with` accepting an array (multi-cell pad) is allowed or
  coerced to its top-left element.
- `#N/A` default confirmed but exact padding for ragged inputs is
  unverified.
- Whether `rows`/`columns` of `0` on an empty array is legal.
