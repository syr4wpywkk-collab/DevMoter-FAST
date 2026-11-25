# FIND

`FIND(find_text, within_text, [start_num])` — returns the 1-based
position of `find_text` in `within_text`, case-sensitive.

## Arguments
- `find_text`, `within_text`: coerced to text (numbers become their
  canonical text form; booleans `"TRUE"`/`"FALSE"`).
- `start_num`: optional starting position (1-based). Defaults to 1.
  Must be >= 1 and <= LEN(within_text); otherwise `#VALUE!`.

## Behavior
- Case-sensitive, no wildcards (`?` and `*` are literal).
- Returns the position of the first match at or after `start_num`.
- Empty `find_text` -> returns `start_num` (or 1).

## Errors
- `#VALUE!` when no match, or `start_num` out of range.
- Errors in any argument propagate.

## Edge cases
- `FIND("M","Miriam")` -> `1`; `FIND("m","Miriam")` -> `6`.
- `FIND("a","banana",4)` -> `5`.
- Positions count Unicode characters (Excel counts double-byte
  characters differently in DBCS locales — see open question).

## Open questions
- Whether positions count Unicode scalar values, grapheme clusters, or
  UTF-16 code units for characters outside the BMP (Excel uses UTF-16
  semantics internally).
- `start_num` > LEN with empty `find_text`: `#VALUE!` or LEN+1?
