# SHEET

`SHEET([reference])` — returns the 1-based position (index) of the
worksheet containing `reference`, or of the calling sheet when
omitted.

v3 expansion (track S10). Introduced in Excel 2013 together with
`SHEETS`.

## Engine requirements
- Multi-sheet workbook model with a stable sheet ordering — v2 plan
  §3.2 already has `sheet_id` in `CellId`; requires exposing the
  sheet's ordinal position to functions. `reference` must be passed
  un-dereferenced (as with `ISREF`/`ISFORMULA`).

## Arguments
- `reference`: optional. A cell/range reference (possibly
  cross-sheet, e.g. `Sheet2!A1`) or a sheet name string? — Excel
  accepts `SHEET("Sheet2")`? — **confirm**: Microsoft docs describe
  `value` as "the name of a sheet or a reference". If a text sheet
  name is accepted, `SHEET("Sheet2")` returns Sheet2's index.
- Omitted -> index of the sheet containing the formula.

## Semantics
- Position is 1-based over **all sheets including hidden ones**
  (documented: hidden sheets are included in the count/order).
- Referencing a sheet that doesn't exist -> `#REF!`-class error
  (confirm exact error — likely `#REF!` or `#VALUE!`).
- `SHEET` of a 3-D or multi-area reference -> `#NA`? — unconfirmed.

## Errors
- Invalid/unknown reference or name -> error (exact code unconfirmed,
  expected `#REF!`).

## Examples
- `=SHEET()` (on first sheet of a 3-sheet book) -> `1`
- `=SHEET(Sheet2!A1)` -> `2`
- `=SHEET("Sheet3")` -> `3` (if name-argument form confirmed)
- `=SHEET(Sheet9!A1)` (no such sheet) -> `#REF!` (expected)

## Open questions
- Whether the argument may be a bare sheet-name text.
- Exact error type for missing sheets and for non-reference values.
- Interaction with very-hidden/chart sheets if those are ever modeled.
