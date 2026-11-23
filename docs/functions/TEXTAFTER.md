# TEXTAFTER

`TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` —
returns the text occurring *after* the given delimiter instance.

## Arguments
- `text`: required; coerced to text; array input maps element-wise
  (spills).
- `delimiter`: required text; empty delimiter is invalid —
  `#VALUE!`? (SPEC-OPEN: Excel returns `#VALUE!` for `""`).
- `instance_num`: optional, default `1`; the n-th occurrence from the
  left; **negative** counts from the right (`-1` = last). `0` ->
  `#VALUE!`.
- `match_mode`: optional `0` case-sensitive (default), `1`
  case-insensitive.
- `match_end`: optional `0` (default) — don't treat end-of-text as a
  delimiter; `1` — treat end-of-text as a delimiter (if the delimiter
  is absent, everything counts as "after" — behavior: returns `""`
  for positive instance, whole text for negative instance — verify).
- `if_not_found`: optional value returned instead of `#N/A` when the
  delimiter isn't found.

## Semantics
- Returns everything strictly after the matched delimiter instance.
- Delimiter not found -> `if_not_found` if supplied, else `#N/A`.
- Result may be `""` (delimiter at end).

## Errors
- `#N/A` delimiter absent and no `if_not_found`.
- `#VALUE!` `instance_num = 0`, out-of-range instance (|n| >
  occurrences), empty delimiter, invalid `match_mode`/`match_end`.
- Errors propagate.

## Examples
- `TEXTAFTER("Red fox jumps"," ")` -> `"fox jumps"`
- `TEXTAFTER("a-b-c","-",2)` -> `"c"`
- `TEXTAFTER("a-b-c","-",-1)` -> `"c"`
- `TEXTAFTER("ABC","abc")` -> `#N/A`;
  `TEXTAFTER("ABC","abc",1,1)` -> `""` (case-insensitive: everything
  after delimiter = empty)
- `TEXTAFTER("abc","z",1,0,0,"none")` -> `"none"`
- `TEXTAFTER("abc","z",-1,0,1)` -> `"abc"` (match_end: treat end as
  delimiter -> last instance "found" at end — verify)

## Compatibility
- Microsoft 365 / Excel 2021+ (shipped with `TEXTBEFORE`,
  `TEXTSPLIT`). Not in Excel 2019- (`#NAME?`).

## Open questions
- Empty delimiter error identity and whether it returns whole text in
  some versions.
- Exact `match_end=1` semantics for positive vs negative instance.
- Multi-char delimiter matching rules; overlapping occurrences
  (`instance_num` counting in `"aa","a-a"` style inputs).
