# FALSE

`FALSE()` — returns the logical value FALSE.

## Arguments
- None. `FALSE(x)` is an arity error. Note: `FALSE` without
  parentheses may appear as a bare literal — parser must treat it as
  the same constant (Excel allows `=FALSE`).

## Behavior
- `FALSE()` -> Boolean false; `NOT(FALSE())` -> TRUE.
- In numeric contexts coerces to 0 (`FALSE()+0` -> 0; `FALSE()*5` -> 0).
- In text context displays as "FALSE" (locale-dependent? — engine
  keeps en-US literals for the canonical form).

## Errors
- Arity only.

## Compatibility
- Legacy; `=FALSE` (no parens) is equivalent — confirm parser alias.

## Open questions
- None beyond the bare-literal parse note.
