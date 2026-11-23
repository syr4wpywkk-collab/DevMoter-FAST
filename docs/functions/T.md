# T

`T(value)` — returns `value` if it is text; otherwise `""`. Used to
guard text operations against non-text values.

## Arguments
- `value`: required single scalar or reference.

## Semantics
- `Text` -> returned unchanged.
- `Number` -> `""`.
- `Boolean` -> `""`.
- `Blank` -> `""` (confirm: expected `""` since blank is not text).
- `Error` -> propagates the error (Excel: `T(1/0)` -> `#DIV/0!`).
- Range/array input: under implicit intersection picks one cell;
  with dynamic arrays maps element-wise — SPEC-OPEN per engine model.

## Errors
- Error argument propagates.

## Examples
- `T("abc")` -> `"abc"`
- `T(123)` -> `""`
- `T(TRUE)` -> `""`
- `T("")` -> `""`
- `T(1/0)` -> `#DIV/0!`

## Compatibility
- All Excel versions; dates back to pre-Excel spreadsheet
  compatibility. Companion of `N()` (inverse-ish: `N` converts text
  to 0/number). Note: `T` is NOT the same as `IF(ISTEXT(v),v,"")` on
  errors — `T` propagates errors.

## Open questions
- Array/range broadcast behavior under dynamic arrays.
- `T` of a `Text("")` vs `Blank` distinction is unobservable (both
  `""`) — no issue, but confirm `T(blank)` isn't `0`.
