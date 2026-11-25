# LARGE

`LARGE(array, k)` — returns the k-th largest number in `array`.

## Arguments
- `array`: range or array; non-numeric values (text, booleans, blanks)
  are ignored; errors propagate.
- `k`: 1-based rank from the largest; truncated to integer.

## Behavior
- `LARGE({3,5,1,4},1)` -> `5`; `LARGE({3,5,1,4},4)` -> `1`.
- Duplicate values each count: `LARGE({5,5,3},2)` -> `5`.

## Errors
- `#NUM!` when `k` < 1 or `k` > count of numeric values.
- `#NUM!` when there are no numeric values at all.

## Edge cases
- `k` equal to the numeric count returns the minimum.
- Non-integer `k` truncated (verify vs Excel).

## Open questions
- Whether numeric text inside a range is ignored (expected yes, same as
  SUM's range rules — confirm).
