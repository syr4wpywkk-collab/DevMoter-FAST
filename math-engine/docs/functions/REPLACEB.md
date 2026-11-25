# REPLACEB

`REPLACEB(old_text, start_num, num_bytes, new_text)` — byte-oriented
variant of `REPLACE`: replaces `num_bytes` bytes starting at byte
position `start_num` with `new_text`.

## Arguments
- `old_text`: required; coerced to text.
- `start_num`: 1-based byte position; >= 1.
- `num_bytes`: byte count to remove; >= 0.
- `new_text`: inserted text.

## Semantics
- Same positional replace as `REPLACE` but counted in bytes
  (double-byte char = 2): `REPLACEB("東京都",3,2,"市")` -> `"東市都"`.
- `num_bytes = 0` inserts; `start_num` past the end appends;
  past-end range clamps to the end.
- Split-character boundaries: when `start_num`/`num_bytes` cut
  through a double-byte character, the rule is the same open question
  as `MIDB`/`LEFTB` (expected: partial bytes are not emitted — the
  cut characters are removed whole or kept? — **SPEC-OPEN**; must
  match the shared byte model).

## Errors
- `#VALUE!` for `start_num` < 1 or `num_bytes` < 0 or non-coercible
  args. Errors propagate.

## Examples
- `REPLACEB("東京都",3,2,"市")` -> `"東市都"`
- `REPLACEB("abcdef",2,3,"X")` -> `"aXef"` (ASCII identical to
  `REPLACE`)
- `REPLACEB("abc",4,1,"d")` -> `"abcd"` (append)
- `REPLACEB("abc",1,0,"X")` -> `"Xabc"` (insert)
- `REPLACEB("abc",0,1,"X")` -> `#VALUE!`

## Engine requirements
- Shared byte-width model (`FINDB.md`).

## Compatibility
- All Excel versions with DBCS; degrades to `REPLACE` otherwise.

## Open questions
- Boundary rule when the removed range splits a double-byte char.
- Fractional `start_num`/`num_bytes` truncation.
