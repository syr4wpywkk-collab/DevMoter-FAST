# MODE.SNGL

`MODE.SNGL(number1, [number2], ...)` — returns the most frequently
occurring numeric value; the first-encountered mode wins ties.

## Arguments
- Scalar args and ranges; range values: text/booleans/blanks ignored,
  errors propagate; direct args use direct coercion rules.

## Behavior
- Returns the single most frequent value.
- Tie in frequency: the value that appears first in argument order
  (row-major for ranges) is returned.

## Errors
- `#N/A` when no value repeats (all frequencies 1) or the set is empty.

## Edge cases
- `MODE.SNGL({1,2,2,3,3})` -> `2` (first mode encountered).
- Single unique value `MODE.SNGL({5})` -> `#N/A` (no repetition) —
  verify: Excel returns `#N/A` for a single value? Confirm.

## Open questions
- Excel returns the lowest-*encountered* mode on ties — confirm vs
  lowest-value or implementation-defined, and whether a single-element
  input or all-distinct input is `#N/A`.
