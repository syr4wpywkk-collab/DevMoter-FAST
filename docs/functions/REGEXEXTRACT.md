# REGEXEXTRACT

`REGEXEXTRACT(text, pattern, [return_mode], [case_sensitivity])` —
extracts substrings matching a regular expression. New function
(Microsoft 365, 2024).

## Arguments
- `text`: required; coerced to text. May be a range/array — the
  function maps element-wise and spills (requires dynamic arrays).
- `pattern`: required regex. Excel uses the **ECMAScript (JavaScript)
  regex dialect** (PCRE2 documented in early previews; the shipped
  dialect is JavaScript — **SPEC-OPEN**, pin dialect in fixtures).
- `return_mode`: optional `0` first match (default), `1` all matches
  as an array, `2` capture groups of the first match.
- `case_sensitivity`: optional `0` case-sensitive (default), `1`
  case-insensitive.

## Semantics
- Mode 0: first match of `pattern` in `text` (leftmost match;
  greediness per dialect). No match -> `#N/A`.
- Mode 1: all non-overlapping matches as a horizontal spill
  (`CALC!`/`#SPILL!` rules apply); zero matches -> `#N/A`.
- Mode 2: capture groups of the first match only, spilled
  horizontally; a pattern with no groups -> the whole match
  (confirm); no match -> `#N/A`.
- Empty match behavior (e.g. pattern `a*`) — SPEC-OPEN.

## Errors
- Invalid regex (syntax error) -> `#VALUE!` (confirm; may be
  `#CALC!` — SPEC-OPEN).
- Invalid `return_mode`/`case_sensitivity` -> `#VALUE!`.
- No match -> `#N/A`.

## Examples
- `REGEXEXTRACT("Order 1234","\d+")` -> `"1234"`
- `REGEXEXTRACT("a1b2c3","\d",1)` -> `{"1","2","3"}` (spilled)
- `REGEXEXTRACT("2024-01-15","(\d+)-(\d+)-(\d+)",2)` ->
  `{"2024","01","15"}` (capture groups, spilled)
- `REGEXEXTRACT("ABC","abc")` -> `#N/A`;
  `REGEXEXTRACT("ABC","abc",0,1)` -> `"ABC"`
- `REGEXEXTRACT("x","[")` -> `#VALUE!` (invalid regex)

## Engine requirements
- A regex engine over UTF-8 strings. `calc-core` forbids external
  crates; regex support must either be a std-only implementation in
  scope or live outside calc-core — flag to architecture. Also needs
  dynamic-array spill for modes 1/2 and array input.

## Compatibility
- Microsoft 365 (insiders/current channel, 2024+). Not in perpetual
  Excel or older versions (`#NAME?`). LibreOffice has
  `REGEX` (different name/dialect).

## Open questions
- Regex dialect (ECMAScript documented at GA; earlier docs said
  PCRE2) and feature subset (lookarounds, backreferences, Unicode
  classes, flags).
- Error for malformed pattern (`#VALUE!` vs `#CALC!`).
- Empty-match and zero-length match semantics in mode 1.
- Behavior when `text` is a 2-D array (spill layout row-major
  presumed).
