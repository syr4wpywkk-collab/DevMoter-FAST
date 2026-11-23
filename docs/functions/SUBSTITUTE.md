# SUBSTITUTE

`SUBSTITUTE(text, old_text, new_text, [instance_num])` — replaces
occurrences of `old_text` with `new_text`.

## Arguments
- `text`: source string (coerced to text).
- `old_text`: substring to find; empty -> `text` returned unchanged.
- `new_text`: replacement string (may be empty -> deletion).
- `instance_num`: optional; if given, only that occurrence (1-based) is
  replaced. Must be >= 1, else `#VALUE!`.

## Behavior
- Case-sensitive; no wildcards.
- Without `instance_num`, all occurrences are replaced.
- Non-overlapping left-to-right scan: `SUBSTITUTE("aaa","aa","b")` ->
  `"ba"`.

## Errors
- `#VALUE!` for `instance_num` <= 0.
- Errors in arguments propagate.

## Edge cases
- `SUBSTITUTE("Quarter 1, 2008","1","2",1)` replaces only the first `1`.
- `instance_num` beyond the count of occurrences -> `text` unchanged.
- `old_text` equal to `new_text` -> `text` unchanged.

## Open questions
- Whether an `instance_num` larger than the occurrence count is an error
  in any Excel version (expected: silently unchanged — confirm).
- Unicode position counting consistent with FIND (see FIND open
  question).
