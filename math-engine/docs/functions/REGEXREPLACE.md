# REGEXREPLACE

`REGEXREPLACE(text, pattern, replacement, [occurrence], [case_sensitivity])` —
replaces regex matches in `text` with `replacement`. New function
(Microsoft 365, 2024).

## Arguments
- `text`: required; coerced to text; array input maps element-wise
  (spills).
- `pattern`: required regex (same dialect question as
  `REGEXEXTRACT.md` — SPEC-OPEN).
- `replacement`: required text. Capture-group backreferences via
  `$1`, `$2`, ... (`$0` = whole match) per JavaScript `replace`
  conventions — **confirm**; `$$`/`$&` semantics SPEC-OPEN.
- `occurrence`: optional `0` replace all (default), or a positive
  integer n replacing only the n-th match.
- `case_sensitivity`: optional `0` sensitive (default), `1`
  insensitive.

## Semantics
- Matches are non-overlapping, scanned left to right.
- `occurrence = n`: only the n-th match is replaced; if fewer than n
  matches exist, `text` is returned unchanged.
- No match -> the original `text` unchanged (NOT `#N/A` — verify;
  documented behavior returns the input).

## Errors
- Invalid regex -> `#VALUE!` (or `#CALC!` — SPEC-OPEN).
- Invalid `occurrence` (negative) / `case_sensitivity` -> `#VALUE!`.
- Errors propagate.

## Examples
- `REGEXREPLACE("a1b2","\d","#")` -> `"a#b#"`
- `REGEXREPLACE("a1b2","\d","#",2)` -> `"a1b#"` (only 2nd match)
- `REGEXREPLACE("2024-01-15","(\d+)-(\d+)-(\d+)","$3/$2/$1")` ->
  `"15/01/2024"` (backreferences — confirm syntax)
- `REGEXREPLACE("ABC","abc","x",0,1)` -> `"x"`
- `REGEXREPLACE("abc","z","#")` -> `"abc"`

## Engine requirements
- Same regex engine requirement as `REGEXEXTRACT` (std-only
  constraint noted there); plus replacement-template expansion and
  dynamic-array spill for array `text`.

## Compatibility
- Microsoft 365 (2024+). Not in perpetual Excel (`#NAME?`).

## Open questions
- Regex dialect and supported substitution syntax (`$1` vs `\1`;
  named groups `$<name>`).
- Malformed-pattern error identity.
- Literal `$` escaping (`$$`) and unmatched backreference handling
  (`$9` with fewer groups: empty or literal?).
