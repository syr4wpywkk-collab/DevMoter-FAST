# COUNT

`COUNT(value1, [value2], ...)` — counts numeric values.

## Behavior
- Counts numbers (including dates-as-serials later, 0, negatives).
- In **ranges**: ignores text (even `"5"`), booleans, blanks, and error
  cells.
- In **direct args**: numeric text and booleans are coerced and counted;
  non-numeric text is *not* counted (does not error).
- Total count of numerics = return value; `COUNT` never errors for
  argument content.

## Edge cases
- `COUNT(0)` -> 1.
- Error cells inside a range are skipped (not counted, not propagated).
  **SPEC-OPEN**: verify Excel skips rather than propagates.
- Errors *produced inside* an argument expression propagate (e.g.
  `COUNT(1/0)` -> `#DIV/0!`).

## Confirm against reference
- Error-cell-in-range behavior above.
- Whether `"5"` direct arg coercion extends to `COUNT` (expected yes).
