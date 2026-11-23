# SHEETS

`SHEETS([reference])` — returns the number of worksheets in the
workbook (argument omitted) or spanned by a 3-D reference.

v3 expansion (track S10). Excel 2013+, paired with `SHEET`.

## Engine requirements
- Multi-sheet model (as `SHEET`). The 3-D-reference form
  (`SHEETS(Sheet1:Sheet3!A1)`) additionally requires parser/model
  support for sheet-span references — treat as phased: implement the
  zero-argument form first.

## Arguments
- `reference`: optional cell or 3-D sheet-span reference.

## Semantics
- `SHEETS()` -> count of all worksheets in the current workbook,
  **including hidden sheets** (documented).
- `SHEETS(Sheet1!A1)` -> `1` (a normal reference spans one sheet).
- `SHEETS(Sheet1:Sheet3!A1)` -> `3` — counts the sheets between the
  named endpoints inclusive (requires 3-D refs — open/engine req).
- Argument may also be a defined-name reference — out of scope until
  names exist.

## Errors
- Reference to a missing sheet -> `#REF!` (expected, confirm).
- Non-reference scalar argument -> `#VALUE!`? (unconfirmed).

## Examples
- `=SHEETS()` (3-sheet workbook) -> `3`
- `=SHEETS(Sheet2!B4)` -> `1`
- `=SHEETS(Sheet1:Sheet2!A1)` -> `2` (3-D ref; phased)
- `=SHEETS(Sheet1:Sheet3!A1)` with hidden Sheet2 -> `3`

## Open questions
- 3-D reference support timeline.
- Exact error codes for invalid arguments.
- Whether chart/macro sheets would ever count (out of scope).
