# UPPER

`UPPER(text)` — converts text to uppercase.

## Arguments
- `text`: coerced to text. Numbers become canonical text then
  uppercased (no-op); booleans -> `"TRUE"`; blank -> `""`; errors
  propagate.

## Behavior
- ASCII case conversion is required.
- Unicode: plan §2 (note 063) requires Unicode-aware uppercasing with
  known differences from Excel recorded as fixtures.

## Errors
- None beyond propagated argument errors.

## Edge cases
- `UPPER("aBc123")` -> `"ABC123"`.
- `UPPER("")` -> `""`.

## Open questions
- Unicode mapping differences vs Excel: `ß` (Excel -> `ß` historically,
  Unicode full mapping -> `SS`), Turkish `i`/`İ`, Greek final sigma —
  record measured fixtures per reference implementation version.
