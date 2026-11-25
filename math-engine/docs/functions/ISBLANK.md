# ISBLANK

`ISBLANK(value)` — TRUE if `value` refers to an empty cell.

v3 expansion (track S10). Type-test family; see `ISNUMBER.md` /
`ISTEXT.md` for the shared conventions.

## Arguments
- `value`: typically a cell reference; any scalar is accepted.

## Behavior
- `ISBLANK(A1)` where A1 is empty -> TRUE.
- `ISBLANK(A1)` where A1 contains `""` (empty string) -> **FALSE** —
  empty text is not blank (plan §3.1 keeps `Blank` and `Text("")`
  distinct).
- `ISBLANK(A1)` where A1 contains `0`, `FALSE`, or `" "` -> FALSE.
- `ISBLANK()` applied to a *formula argument* value rather than a cell
  reference: a literal passed directly is never Blank ->
  `ISBLANK("")` -> FALSE (confirm against reference; Excel returns
  FALSE for a literal empty string argument).
- Error argument: propagates the error rather than returning FALSE —
  `ISBLANK(1/0)` -> `#DIV/0!` (confirm; consistent with ISNUMBER).

## Errors
- Propagates input errors; otherwise never errors.

## Edge cases
- A cell containing a formula that returns `""` is not blank -> FALSE.
- `ISBLANK` on a multi-cell range argument: Excel applies implicit
  intersection in legacy mode / array-evaluates under dynamic arrays.
  Engine behavior before spill support lands is an open question.

## Examples
- `=ISBLANK(A1)` (A1 empty) -> `TRUE`
- `=ISBLANK(A1)` (A1 = `""` from a formula) -> `FALSE`
- `=ISBLANK(A1)` (A1 = `0`) -> `FALSE`
- `=ISBLANK(NA())` -> `#N/A`

## Open questions
- Whether an out-of-argument blank (e.g. `ISBLANK(B1)` where the
  reference itself is `#REF!`) propagates `#REF!` — expected yes.
- Array semantics of a range argument under implicit intersection vs
  spill.
