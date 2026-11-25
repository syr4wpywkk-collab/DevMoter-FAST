# ISNONTEXT

`ISNONTEXT(value)` — TRUE if `value` is not text; the exact inverse of
`ISTEXT`.

v3 expansion (track S10). Type-test family; see `ISTEXT.md`.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISNONTEXT("x")` -> FALSE; `ISNONTEXT("")` -> FALSE (empty string is
  text).
- `ISNONTEXT(3)` -> TRUE; `ISNONTEXT(TRUE)` -> TRUE;
  `ISNONTEXT(blank)` -> TRUE — **blank cells return TRUE**, which is
  the asymmetric case vs `ISBLANK` users trip on.
- Error argument propagates (confirm; if it propagates, `ISNONTEXT` is
  not strictly `NOT(ISTEXT)` on error inputs — both propagate, so the
  symmetry holds anyway).

## Errors
- Propagates input errors; otherwise never errors.

## Examples
- `=ISNONTEXT("abc")` -> `FALSE`
- `=ISNONTEXT(42)` -> `TRUE`
- `=ISNONTEXT(A1)` (A1 empty) -> `TRUE`
- `=ISNONTEXT("")` -> `FALSE`

## Open questions
- None beyond shared error-propagation confirmation.
