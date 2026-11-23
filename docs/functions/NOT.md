# NOT

`NOT(logical)` — reverses a logical value. Exactly one argument.

## Coercion
- boolean -> negated; number -> `NOT(0)` TRUE, `NOT(nonzero)` FALSE.
- text -> `#VALUE!`; error -> propagates.
- **SPEC-OPEN** (P1-NOT-008): blank cell ref — expected `NOT(blank)` =
  TRUE via blank->FALSE; confirm.

## Edge cases
- Works on expressions: `NOT(2>3)` -> TRUE.
- `NOT("TRUE")` text-form boolean: verify whether Excel coerces `"TRUE"`
  (expected `#VALUE!` — text is not coerced to logical; SPEC-OPEN
  candidate, not in fixture yet).

## Confirm against reference
- Blank coercion, `"TRUE"/"FALSE"` text handling, arity errors.
