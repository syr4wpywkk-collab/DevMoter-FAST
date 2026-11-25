# REGEXTEST

`REGEXTEST(text, pattern, [case_sensitivity])` — returns `TRUE` if
`pattern` matches anywhere in `text`. New function (Microsoft 365,
2024).

## Arguments
- `text`: required; coerced to text; array input maps element-wise
  (spills booleans).
- `pattern`: required regex (dialect SPEC-OPEN — see
  `REGEXEXTRACT.md`).
- `case_sensitivity`: optional `0` case-sensitive (default), `1`
  case-insensitive.

## Semantics
- Search semantics (substring match, not full-string): pattern `b`
  matches `"abc"` -> `TRUE`. Use `^...$` anchors for full match.
- Returns a `Boolean`, never an error for a valid (possibly
  non-matching) pattern.

## Errors
- Invalid regex -> `#VALUE!` (or `#CALC!` — SPEC-OPEN, shared with
  the other REGEX* functions).
- Invalid `case_sensitivity` -> `#VALUE!`.
- Errors propagate.

## Examples
- `REGEXTEST("Order 1234","\d+")` -> `TRUE`
- `REGEXTEST("Order","\d+")` -> `FALSE`
- `REGEXTEST("ABC","^abc$")` -> `FALSE`;
  `REGEXTEST("ABC","^abc$",1)` -> `TRUE`
- `REGEXTEST("x","[")` -> `#VALUE!` (invalid pattern)
- `REGEXTEST({"a1","bc"},"\d")` -> `{TRUE,FALSE}` (spilled — requires
  dynamic arrays)

## Engine requirements
- Regex engine (see `REGEXEXTRACT.md`); simplest of the three to
  implement since it needs only a match predicate. Spill needed for
  array input.

## Compatibility
- Microsoft 365 (2024+). Not in perpetual Excel (`#NAME?`).

## Open questions
- Regex dialect/subset.
- Malformed-pattern error identity.
- Whether anchors/flags in the pattern itself (`(?i)` etc.) are
  honored — depends on dialect.
