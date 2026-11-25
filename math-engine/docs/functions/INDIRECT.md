# INDIRECT

`INDIRECT(ref_text, [a1])` — converts a text string into a live cell
reference. Volatile: recalculates on every recalculation pass.

## Arguments
- `ref_text`: required; text of a reference — A1 (`"B2"`, `"Sheet2!A1:C3"`,
  `"'My Sheet'!$A$1"`), R1C1 (`"R2C2"`, `"R[1]C[-1]"`), or a defined
  name (`"MyRange"`).
- `a1`: optional logical; `TRUE`/omitted = A1 interpretation, `FALSE`
  = R1C1 interpretation.

## Semantics
- The argument is *text*: `INDIRECT("B2")` returns the **value** stored
  in cell B2 (a reference dereference, not the text `"B2"` itself).
- Range text yields the values in the range — a multi-cell result
  requires dynamic-array/spill support; under implicit-intersection
  (legacy) semantics it returns the intersecting cell or `#VALUE!`.
- Concatenation is the idiom: `INDIRECT("B"&ROW())`.
- Sheet names with spaces must be quoted inside the text:
  `INDIRECT("'My Sheet'!A1")`.
- R1C1 relative offsets (`R[1]C[-1]`) are relative to the cell
  containing the `INDIRECT` formula.
- Volatile: any recalc re-evaluates; dependencies through `INDIRECT`
  cannot be statically tracked — **Engine requirement**.

## Coercion
- `ref_text`: text coercion; a numeric arg like `INDIRECT(5)` is
  invalid reference text -> `#REF!` (confirm; may be `#VALUE!` on some
  builds).
- `a1`: boolean coercion; numbers -> nonzero TRUE? (confirm standard
  logical coercion applies).

## Errors
- Text that does not parse as a reference/name -> `#REF!`.
- Valid syntax pointing outside the grid (e.g. `"A0"`, `"XFE1"`) ->
  `#REF!`.
- Reference to a nonexistent sheet -> `#REF!`.
- Reference to a cell in a closed external workbook -> `#REF!`
  (external refs out of scope regardless).
- Circular `INDIRECT` (directly or transitively) -> `#CIRC!`/circular
  detection per engine policy.

## Examples
- `B2` = `10`: `INDIRECT("B2")` -> `10`
- `B2` = `10`, `A1` = `"B"`: `INDIRECT(A1&"2")` -> `10`
- `INDIRECT("Sheet2!C1:C3")` -> array of the three values (spill)
- `INDIRECT("R1C1", FALSE)` -> value of A1
- `INDIRECT("ZZZ999")` -> `#REF!` (outside grid — `ZZZ` beyond `XFD`)

## Engine requirements
- Dynamic references: the dependency graph cannot know the target
  until evaluation; the engine must support volatile functions and
  deferred (evaluation-time) dependency registration or fall back to
  always-recalculate semantics.
- Needs access to the workbook namespace (sheets, defined names) and
  caller position for R1C1 relative forms.

## Compatibility notes
- Available since early Excel; `a1` defaults differ in some localized
  builds? (confirm — standard default is TRUE).
- Excel does not support `INDIRECT` into closed workbooks (returns
  `#REF!`); Google Sheets does.

## Open questions
- Whether a name resolving to a multi-area union is supported.
- Exact error for non-text-non-reference arg (number).
- R1C1 absolute vs relative anchoring details.
