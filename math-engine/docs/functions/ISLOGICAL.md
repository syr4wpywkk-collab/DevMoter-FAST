# ISLOGICAL

`ISLOGICAL(value)` — TRUE if `value` is a logical (boolean).

v3 expansion (track S10). Type-test family; see `ISNUMBER.md`.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISLOGICAL(TRUE)` -> TRUE; `ISLOGICAL(FALSE)` -> TRUE.
- `ISLOGICAL(1)` -> FALSE — numbers are not logicals.
- `ISLOGICAL("TRUE")` -> FALSE — text is not coerced.
- `ISLOGICAL(blank)` -> FALSE.
- Error argument propagates (shared IS-family convention; confirm).

## Errors
- Propagates input errors; otherwise never errors.

## Examples
- `=ISLOGICAL(TRUE)` -> `TRUE`
- `=ISLOGICAL(A1)` (A1 = `FALSE`) -> `TRUE`
- `=ISLOGICAL(1)` -> `FALSE`
- `=ISLOGICAL("TRUE")` -> `FALSE`

## Open questions
- None beyond shared error-propagation confirmation.
