# AVERAGE

`AVERAGE(number1, [number2], ...)` — arithmetic mean of numeric arguments.

## Arguments / coercion
Same coercion table as SUM. The *count* is the number of numeric values
after coercion.

## Errors
- `#DIV/0!` when zero numeric values (range-only-text, empty ranges).
- `#VALUE!` for non-coercible direct text; input errors propagate.

## Edge cases
- `AVERAGE(0)` -> `0`.
- Booleans/blank in ranges are excluded from numerator and denominator.
- Result tolerance: fixtures carry `tolerance` for f64 comparisons.

## Confirm against reference
- `AVERAGE` over a range containing only booleans: `#DIV/0!` expected
  (booleans ignored in ranges) — verify.
