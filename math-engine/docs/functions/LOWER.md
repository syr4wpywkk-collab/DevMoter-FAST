# LOWER

`LOWER(text)` — converts text to lowercase.

## Arguments
- `text`: coerced to text; same rules as UPPER.

## Behavior
- ASCII case conversion required; Unicode-aware lowercasing with Excel
  differences recorded as fixtures (plan §2, note 064).

## Errors
- None beyond propagated argument errors.

## Edge cases
- `LOWER("AbC123")` -> `"abc123"`.

## Open questions
- Characters are mapped one to one; `İ`, whose Unicode lowercase is
  `i` plus a combining dot, is kept. Locale-sensitive Turkish rules still
  need fixtures.
