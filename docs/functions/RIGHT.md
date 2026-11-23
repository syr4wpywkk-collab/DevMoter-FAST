# RIGHT

`RIGHT(text, [num_chars])` — returns the rightmost `num_chars` characters of `text`.

Identical to `LEFT` except the slice is taken from the end of the
string. See `LEFT.md` for the full coercion, counting, and error
tables; differences are listed below.

## Arguments
- `text`: required; coerced to text (same rules as `LEFT`).
- `num_chars`: optional, default `1`; truncated toward zero.

## Behavior
- `RIGHT("abc",2)` -> `"bc"`; `RIGHT("abc")` -> `"c"`.
- `num_chars` = 0 -> `""`; `num_chars` > length -> whole text.
- `num_chars` < 0 -> `#VALUE!`.
- Character counting rule inherits the UTF-16-unit open question from
  `LEFT.md` (slicing must be consistent with `LEN`).

## Errors
- Same as `LEFT`: negative/non-coercible `num_chars` -> `#VALUE!`;
  errors propagate.

## Open questions
- Same as `LEFT` (counting units, number formatting).
