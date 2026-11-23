# SWITCH

`SWITCH(expression, value1, result1, [value2, result2], ..., [default])` —
compares `expression` against each `valueN` and returns the matching
`resultN`, else `default`.

v2 plan §2 (086): compare target and candidates, default, lazy
evaluation of unselected branches.

## Arguments
- `expression`: evaluated once; compared to each candidate.
- Up to 126 `value`/`result` pairs plus optional trailing `default`.

## Behavior
- `SWITCH(A1, 1, "one", 2, "two", "other")`.
- Left-to-right: first equal candidate wins; its `result` — and only
  that `result` — is evaluated (lazy, like `IFS`/`CHOOSE`).
- Comparison is **exact** equality of the coerced scalar: numbers by
  value, text case-insensitively (confirm — Excel is
  case-insensitive), booleans strictly; no wildcard support (confirm).
- No match and no `default` -> `#N/A`.

## Errors
- No match without default -> `#N/A`.
- `expression` evaluates to error -> propagates.
- Error in an unreached candidate/result does not propagate.
- Even arity (candidate without result) -> parse/arity error (confirm).

## Edge cases
- `SWITCH(TRUE(), A1>10, "big", "small")` idiom — relies on boolean
  equality comparisons.
- Blank `expression` vs blank candidate -> matches (blank == blank)?
  fixture needed.

## Open questions
- Case sensitivity of text comparison.
- Wildcard treatment in candidates (expected literal).
- Blank/empty-string equality rules in comparisons.
