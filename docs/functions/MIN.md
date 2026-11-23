# MIN

`MIN(number1, [number2], ...)` — smallest numeric value.

## Arguments / coercion
Same coercion table as SUM.

## Behavior
- No numeric values -> `0` (not an error; differs from AVERAGE).
- Errors in inputs propagate.

## Edge cases
- All-negative inputs -> most negative value (see P1-MIN-004).
- `MIN` of a single value returns that value.
- Comparison is plain f64 ordering; `-0` vs `+0` treated as equal.

## Confirm against reference
- MIN over range of only error cells: error propagates vs 0 — verify
  (expect propagation).
