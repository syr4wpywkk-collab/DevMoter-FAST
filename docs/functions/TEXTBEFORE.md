# TEXTBEFORE

`TEXTBEFORE(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])` —
returns the text occurring *before* the given delimiter instance.
Mirror of `TEXTAFTER`.

## Arguments
- Same argument list as `TEXTAFTER` (`text`, `delimiter`,
  `[instance_num]`, `[match_mode]`, `[match_end]`, `[if_not_found]`).
- `instance_num`: `1` = first from left (default); negative counts
  from the right (`-1` = last). `0` -> `#VALUE!`.
- `match_end`: `1` treats end-of-text as a delimiter, so an absent
  delimiter yields the whole text for positive instances — verify.

## Semantics
- Returns everything strictly before the matched delimiter instance.
- Delimiter not found -> `if_not_found` or `#N/A`.
- `TEXTBEFORE(t,d)` + delimiter + `TEXTAFTER(t,d)` reconstructs `t`
  for the first instance — useful fixture invariant.

## Errors
- `#N/A` no match without `if_not_found`.
- `#VALUE!` invalid `instance_num`/`match_mode`/`match_end`, empty
  delimiter. Errors propagate.

## Examples
- `TEXTBEFORE("Red fox jumps"," ")` -> `"Red"`
- `TEXTBEFORE("a-b-c","-",2)` -> `"a-b"`
- `TEXTBEFORE("a-b-c","-",-1)` -> `"a-b"`
- `TEXTBEFORE("abc","b")` -> `"a"`
- `TEXTBEFORE("abc","z",1,0,0,"none")` -> `"none"`
- `TEXTBEFORE("ABC","abc",1,1)` -> `""` (insensitive match at start)

## Compatibility
- Microsoft 365 / Excel 2021+; pairs with `TEXTAFTER`/`TEXTSPLIT`.
  Not in Excel 2019- (`#NAME?`).

## Open questions
- Same as `TEXTAFTER`: empty delimiter behavior, `match_end` exact
  semantics, overlap/instance counting rules.
