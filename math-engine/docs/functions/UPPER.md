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
- Characters are mapped one to one, so the length never changes: `ß`,
  whose Unicode uppercase is `SS`, stays `ß` (`UPPER("straße")` ->
  `"STRAßE"`). Turkish `i`/`İ` and Greek final sigma still need measured
  fixtures.
