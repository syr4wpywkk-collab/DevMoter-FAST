# ISTEXT

`ISTEXT(value)` — TRUE if `value` is text.

v2 plan §2 (088): text type test; distinguish blank and errors.

## Arguments
- `value`: any scalar, cell ref, or expression result.

## Behavior
- `ISTEXT("abc")` -> TRUE; `ISTEXT("")` -> TRUE (empty string IS text
  — distinct from blank per plan §3.1).
- `ISTEXT(3)` -> FALSE; `ISTEXT(TRUE)` -> FALSE;
  `ISTEXT(blank)` -> FALSE.
- Error argument -> propagates (confirm, mirroring ISNUMBER).

## Errors
- Propagates input errors; otherwise never errors.

## Edge cases
- Cell formatted as text but containing a number: value type decides
  (number -> FALSE).
- `" "` (space) is text -> TRUE.

## Open questions
- None beyond shared error-propagation confirmation.
