# LEFT

`LEFT(text, [num_chars])` — returns the leftmost `num_chars` characters of `text`.

## Arguments
- `text`: required; any scalar is coerced to text.
- `num_chars`: optional, default `1`; coerced to number, truncated
  toward zero to an integer.

## Type coercion
- `Number` -> decimal text per engine text-of-number rules (confirm
  formatting of e.g. `1e3`, `1.5`).
- `Boolean` -> `"TRUE"`/`"FALSE"`.
- `Blank` -> `""` (empty text) -> result `""`.
- `Error` propagates.
- Numeric-text `num_chars` (`"3"`) coerces; non-numeric -> `#VALUE!`.
- Blank referenced cell as `num_chars` -> 0 (confirm).

## Character counting
- Excel counts UTF-16 code units (surrogate pairs count as 2).
  Internally the engine holds UTF-8 `String`s; the spec defers to the
  shared text-coercion module for the counting rule. **SPEC-OPEN**:
  adopt UTF-16-unit counting for compatibility vs scalar-value
  counting; measure fixture impact before freezing.

## Errors
- `num_chars` < 0 -> `#VALUE!`.
- `num_chars` non-coercible -> `#VALUE!`.
- Error in either argument propagates.

## Edge cases
- `num_chars` = 0 or omitted-with-`0` -> `""`.
- `num_chars` > length -> whole text.
- Fractional `num_chars` (e.g. `2.9`) truncates to 2.
- `LEFT(text)` with omitted arg returns first character.

## Open questions
- UTF-16-unit vs Unicode-scalar counting (flagged in plan §6).
- Number-to-text formatting used for coercion (locale, exponent form).
