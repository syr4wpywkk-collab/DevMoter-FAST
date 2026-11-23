# TRUE

`TRUE()` — returns the logical value TRUE.

## Arguments
- None. `TRUE(x)` is an arity error. Bare `=TRUE` (no parens) is a
  literal alias — parser must support it.

## Behavior
- `TRUE()` -> Boolean true; `TRUE()+0` -> 1; `IF(TRUE(),1,2)` -> 1.
- Displays as "TRUE" in text context.

## Errors
- Arity only.

## Compatibility
- Legacy function; equivalent to the TRUE literal.

## Open questions
- None beyond the bare-literal parse note.
