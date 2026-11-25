# ISFORMULA

`ISFORMULA(reference)` — TRUE if `reference` points to a cell that
contains a formula.

v3 expansion (track S10). Introduced in Excel 2013.

## Engine requirements
- Requires the evaluator to pass the argument as an un-resolved
  reference AND the workbook model to expose whether a cell's content
  is a formula vs a literal (cells may store both; plan §3.2 keeps
  formula source + AST + cached value, so this is feasible).

## Arguments
- `reference`: a cell or range reference. If the argument is **not** a
  reference (a value), Excel returns `#VALUE!` — NOT FALSE
  (confirm).

## Behavior
- `ISFORMULA(A1)` where A1 contains `=1+1` -> TRUE.
- `ISFORMULA(A1)` where A1 contains literal `2` -> FALSE.
- `ISFORMULA(A1)` where A1 contains a formula returning an error
  (e.g. `=1/0`) -> **TRUE** — the cell content is a formula regardless
  of the error result. Excel does NOT propagate the referenced cell's
  error (confirm; documented behavior is that ISFORMULA checks the
  cell, not its value).
- `ISFORMULA` on a multi-cell range: returns TRUE if the top-left
  cell contains a formula (legacy behavior) — array/spill behavior is
  an open question.

## Errors
- `#VALUE!` if `reference` is not a reference (e.g. `ISFORMULA(5)`).
- `#REF!` argument propagates.

## Examples
- `=ISFORMULA(A1)` (A1 = `=SUM(B1:B3)`) -> `TRUE`
- `=ISFORMULA(A2)` (A2 = `42` literal) -> `FALSE`
- `=ISFORMULA("A1")` -> `#VALUE!`
- `=ISFORMULA(A3)` (A3 = `=1/0`) -> `TRUE` (expected — confirm)

## Open questions
- Multi-cell range semantics and spill behavior.
- Cells containing array/spill formulas: does a cell inside a spilled
  range (not the anchor) count? Expected FALSE — only the anchor cell
  holds the formula.
