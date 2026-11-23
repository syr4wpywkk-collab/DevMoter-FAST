# ABS

`ABS(number)` — absolute value. Exactly one argument.

## Coercion
- number -> |n|; numeric text -> coerced (`ABS("-2.5")=2.5`).
- boolean -> coerced (TRUE -> 1).
- blank ref -> 0. non-numeric text -> `#VALUE!`. errors propagate.

## Edge cases
- `ABS(0)` -> 0; `ABS(-0)` -> 0 (+0; verify sign of result is +0).
- `ABS` of extremely small/large magnitudes — f64 range.
- **SPEC-OPEN** (P1-ABS-009 confirms blank->0 direction): record that
  `ABS(A1)` with blank A1 returns 0.

## Confirm against reference
- Blank coercion (recorded), `ABS(-0)` sign, text with whitespace
  (`" -2 "`).
