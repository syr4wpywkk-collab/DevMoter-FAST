# MODE.MULT

`MODE.MULT(number1, [number2], ...)` — **all** most-frequently-occurring
values, as a vertical spill array. Excel 2010+; contrast `MODE.SNGL`
(returns first mode only). See `MODE.SNGL.md`.

## Arguments
- `number1`: required (range/array/scalar); further args optional, up
  to 255.

## Coercion
- Same as `MODE.SNGL`/`MEDIAN`: range cells that are text, boolean, or
  blank are ignored; direct scalars coerce (numeric text, booleans);
  non-numeric direct text -> `#VALUE!`; error cells propagate.

## Return value / spill
- Vertical array of every value tied for the maximum frequency.
  Frequencies are compared on exact equality of values; first
  occurrences' order? — Excel returns modes in order of first
  appearance (confirm).
- Single mode -> 1-element array.
- In legacy Excel it required multi-cell CSE entry; extra formula cells
  show `#N/A` when fewer modes than selected cells — engine spills
  naturally instead.

## Errors
- No duplicates (every value distinct) -> `#N/A` (documented).
- No numeric values -> `#N/A`? `MODE.SNGL` gives `#N/A` for all-text
  input — confirm same for `.MULT`.
- Error cells propagate.

## Examples
- `MODE.MULT({1;2;2;3;3;4})` -> `{2;3}`.
- `MODE.MULT({1;1;2;3})` -> `{1}`.
- `MODE.MULT({1;2;3})` -> `#N/A`.
- `MODE.MULT(A1:A10)` over mixed text/numbers ignores text.

## Open questions
- Ordering of multiple modes (first-appearance vs sorted).
- Tie behavior for floats differing only by FP noise (exact equality
  expected).
