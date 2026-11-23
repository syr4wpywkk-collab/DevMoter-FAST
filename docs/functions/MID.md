# MID

`MID(text, start_num, num_chars)` — returns `num_chars` characters starting at 1-based position `start_num`.

## Arguments
- `text`: required; coerced to text (rules as `LEFT.md`).
- `start_num`: required; coerced, truncated toward zero, 1-based.
- `num_chars`: required; coerced, truncated toward zero.

## Behavior
- `MID("abcdef",2,3)` -> `"bcd"`.
- `start_num` > length -> `""`.
- `start_num` < 1 -> `#VALUE!`.
- `num_chars` < 0 -> `#VALUE!`; `num_chars` = 0 -> `""`.
- `start_num + num_chars` past the end clamps to the end (no error).

## Errors
- `start_num` < 1 or `num_chars` < 0 -> `#VALUE!`.
- Non-coercible numeric args -> `#VALUE!`; errors propagate.

## Edge cases
- Fractional args truncate (`MID("abc",1.9,1.9)` -> `"a"`).
- Very large `start_num`/`num_chars` saturates/clamps, no overflow
  error (confirm Excel limit behavior).

## Open questions
- UTF-16-unit vs scalar counting (shared with `LEFT`/`RIGHT`/`LEN`).
- Behavior for `num_chars` so large it overflows `usize` internally —
  clamp (expected).
