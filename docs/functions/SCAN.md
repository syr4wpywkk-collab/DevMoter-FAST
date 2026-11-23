# SCAN

`SCAN([initial_value], array, LAMBDA)` — scans `array` elementwise
(typically row-major) and returns an array of the same shape holding
each intermediate accumulator value.

## Arguments
- `initial_value`: optional seed for the accumulator; when omitted,
  the first element of `array` is used and the LAMBDA is not invoked
  for it — confirm exact Excel rule (vs LAMBDA called with blank
  accumulator? — **SPEC-OPEN**).
- `array`: required array/range.
- `LAMBDA`: required LAMBDA taking exactly two parameters
  `(accumulator, value)`.

## Behavior
- `SCAN(0, {1,2,3,4}, LAMBDA(a, v, a + v))` -> `{1,3,6,10}`.
- `SCAN("", {"a","b","c"}, LAMBDA(a, v, a & v))` -> `{"a","ab","abc"}`
  — accumulator may change type.
- Result shape equals `array` shape (row-major traversal).
- Column-major option does not exist in Excel (unlike `REDUCE` which
  shares traversal row-major — confirm).

## Errors
- LAMBDA arity mismatch -> `#VALUE!`.
- Errors produced inside LAMBDA: that element becomes the error and
  subsequent accumulations feed an error value — vs whole-call
  failure, **SPEC-OPEN**.
- Error *elements* inside `array`: propagated into accumulator.
- Evaluation budget: `count(array)` LAMBDA invocations (or count-1
  without seed).

## Compatibility / engine requirements
- Excel 365 only. Requires LAMBDA and dynamic-array spill.

## Open questions
- Exact no-`initial_value` semantics (seed = first element, or first
  LAMBDA call receives `0`/blank?).
- Traversal order on 2-D arrays (row-major assumed).
- Error propagation policy.
