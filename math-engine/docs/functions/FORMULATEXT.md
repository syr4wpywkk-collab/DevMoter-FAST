# FORMULATEXT

`FORMULATEXT(reference)` — returns the text of the formula stored in
the referenced cell.

## Arguments
- `reference`: required; a reference to a single cell (or a range —
  Excel uses the top-left cell? **Open question**; generally passed a
  single cell). May be another sheet's cell.

## Semantics
- Returns `Text`: the formula exactly as entered, **including** the
  leading `=` (e.g. `=SUM(A1:A3)` -> `"=SUM(A1:A3)"`).
- Cell containing a constant (not a formula) -> `#N/A`.
- Referencing the cell that itself contains the `FORMULATEXT` call is
  circular in Excel? Actually Excel permits `FORMULATEXT` of its own
  cell — it does NOT create a circular reference because the formula's
  *text*, not value, is used (confirm).
- Reference to a cell in a closed workbook -> `#N/A` (external refs are
  out of scope anyway).
- Argument must be a reference, not a value: `FORMULATEXT("=1+1")`
  returns `#VALUE!`? (confirm — Excel requires a reference.)

## Errors
- Reference to a non-formula cell -> `#N/A`.
- Non-reference argument -> `#VALUE!` (confirm).
- `#REF!` argument propagates.
- Formula text exceeding 8192 characters is truncated (Excel limit —
  confirm whether it truncates or errors).

## Examples
- Given `B2` contains `=A1*2`: `FORMULATEXT(B2)` -> `"=A1*2"`
- Given `B2` contains `42`: `FORMULATEXT(B2)` -> `#N/A`
- `FORMULATEXT(B2:B3)` where `B2` has `=1+1` -> `"=1+1"` (top-left cell
  — confirm)

## Engine requirements
- Requires cell metadata: access to the *stored formula text* (or a
  serialized AST) of the referenced cell, plus the reference itself
  passed as a reference value rather than its evaluated value.
- Circular-reference policy must special-case textual access.

## Compatibility notes
- Introduced in Excel 2013. Localized formula text vs canonical en-US
  serialization is an engine decision (canonical recommended).

## Open questions
- Multi-cell reference behavior (top-left vs implicit intersection).
- Whether the returned text preserves original spacing/case or a
  normalized serialization.
- Self-reference legality.
