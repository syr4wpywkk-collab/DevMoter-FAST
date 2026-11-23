# SMALL

`SMALL(array, k)` — returns the k-th smallest number in `array`.

## Arguments
- Same coercion rules as LARGE.

## Behavior
- `SMALL({3,5,1,4},1)` -> `1`; `SMALL({3,5,1,4},4)` -> `5`.
- Duplicates count individually.

## Errors
- `#NUM!` for `k` < 1, `k` > numeric count, or empty numeric set.

## Edge cases
- `LARGE(x, k) = SMALL(x, n - k + 1)` for n numeric values — use as a
  property check.
- Non-integer `k` truncated (verify).

## Open questions
- Same as LARGE: range text handling and `k` truncation rule.
