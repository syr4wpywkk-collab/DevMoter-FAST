# REPLACE

`REPLACE(old_text, start_num, num_chars, new_text)` — replaces
`num_chars` characters starting at `start_num` with `new_text`.

## Arguments
- `old_text`: source string.
- `start_num`: 1-based position where replacement begins; >= 1.
- `num_chars`: number of characters removed; >= 0.
- `new_text`: inserted text (may be empty).

## Behavior
- Position-based (not search-based): `REPLACE("abcdef",2,3,"X")` ->
  `"aXef"`.
- `num_chars = 0` inserts without deleting.
- `start_num` > LEN(old_text) appends at the end.
- `start_num + num_chars` past the end removes to the end.

## Errors
- `#VALUE!` for `start_num` < 1 or `num_chars` < 0.
- Errors propagate.

## Edge cases
- `REPLACE("2009",3,2,"10")` -> `"2010"`.
- `REPLACE("abc",4,1,"d")` -> `"abcd"` (append).
- Non-integer `start_num`/`num_chars` are truncated toward zero
  (Excel truncates; verify).

## Open questions
- Unicode counting (same question as FIND).
- Exact behavior when `start_num`/`num_chars` are fractional —
  truncation vs rounding.
