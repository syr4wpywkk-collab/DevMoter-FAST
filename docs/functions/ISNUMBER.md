# ISNUMBER

`ISNUMBER(value)` — TRUE if `value` is a number.

v2 plan §2 (087): numeric type test; does NOT implicitly coerce
numeric text.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISNUMBER(3)` -> TRUE; `ISNUMBER(3.5)` -> TRUE.
- `ISNUMBER("3")` -> **FALSE** — no coercion of numeric-looking text.
- `ISNUMBER(TRUE)` -> FALSE; `ISNUMBER(blank)` -> FALSE.
- Date/time serials are numbers -> `ISNUMBER(TODAY())` -> TRUE.
- Error argument: propagates the error, does not return FALSE —
  `ISNUMBER(1/0)` -> `#DIV/0!` (confirm; Excel propagates).

## Errors
- Propagates input errors; otherwise never errors.

## Edge cases
- `ISNUMBER` on a cell containing an error -> propagates (used with
  `IFERROR` for guards).
- `TRUE`/`FALSE` literals are booleans, not numbers.

## Open questions
- None beyond error-propagation confirmation.
