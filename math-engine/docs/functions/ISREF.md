# ISREF

`ISREF(value)` — TRUE if `value` is a cell/range reference.

v3 expansion (track S10).

## Engine requirements
- Requires a first-class `Reference` value in the engine's value model
  (v2 plan §3 lists `Reference` among the value kinds). If references
  are always resolved to cell values before function call, `ISREF`
  cannot be implemented — the evaluator must pass the argument
  through un-dereferenced, as it does for `ISFORMULA`/`SHEET`.

## Arguments
- `value`: any expression.

## Behavior
- `ISREF(A1)` -> TRUE; `ISREF(A1:B2)` -> TRUE; `ISREF(Sheet1!A1)` ->
  TRUE.
- `ISREF(5)`, `ISREF("A1")`, `ISREF(TRUE)` -> FALSE — a text string
  that *looks* like a reference is not a reference.
- `ISREF(INDIRECT("A1"))` -> TRUE (the returned value is a reference)
  — requires `INDIRECT`, which is itself a dynamic-reference engine
  feature (flag, not currently in scope).
- A `#REF!` literal is an error, not a reference: `ISREF(#REF!)`
  propagates the error or returns FALSE — **open question** (Excel
  help implies ISREF can take "a reference to a cell", and deleted
  references produce `#REF!` which propagates — confirm).

## Errors
- Expected to propagate genuine error values (confirm whether
  `#REF!`-typed arguments return FALSE instead).

## Examples
- `=ISREF(A1)` -> `TRUE`
- `=ISREF("A1")` -> `FALSE`
- `=ISREF(A1:B5)` -> `TRUE`
- `=ISREF(1+1)` -> `FALSE`

## Open questions
- `#REF!` argument semantics.
- Whether named ranges / table structured references count as
  references (out of scope until those features exist).
