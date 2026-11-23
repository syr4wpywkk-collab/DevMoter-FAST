# LEN

`LEN(text)` — returns the number of characters in `text`.

## Arguments
- `text`: required single scalar; any scalar is coerced to text.

## Type coercion
- `Number` -> text of number then counted (`LEN(123)` -> 3). The exact
  number-formatting rule (signs, decimals, exponents) is **SPEC-OPEN**
  and shared with the text functions.
- `Boolean` -> counts `"TRUE"`/`"FALSE"` (4/5).
- `Blank` (via reference) -> 0.
- `Error` propagates.
- Range/array argument: not valid for a scalar signature — array
  formula behavior is out of scope (Open question).

## Counting rule
- Same open question as `LEFT`: Excel counts UTF-16 code units;
  engine strings are UTF-8. Freeze the rule once fixtures exist —
  `LEN` must agree with `LEFT`/`RIGHT`/`MID` on what a "character" is.

## Errors
- Error argument propagates.
- No result can be negative or error otherwise.

## Open questions
- UTF-16-unit vs Unicode-scalar counting.
- Whether `LEN` over a range broadcasts (array formula) — pending
  dynamic-array support.
