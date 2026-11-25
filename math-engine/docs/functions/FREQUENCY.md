# FREQUENCY

`FREQUENCY(data_array, bins_array)` — counts how many values fall into
each bin; returns a vertical array of `n_bins + 1` elements
(bin upper bounds are inclusive; the last element counts values
strictly greater than the largest bin).

## Arguments
- `data_array`: range/array of values; non-numeric cells ignored.
- `bins_array`: range/array of numeric upper bounds, sorted ascending
  (Excel sorts?? — bins need not be pre-sorted? Documented: results
  follow bin order; unsorted bins produce odd but defined results —
  **confirm**).

## Array / spill behavior
- Must be entered as an array formula (CSE) in legacy Excel; spills
  vertically under dynamic arrays. Result length = `count(bins) + 1`
  **only when `bins_array` is a range**; for a literal array argument
  Excel returns just one value unless CSE'd — **confirm**; modern
  spill returns n+1 always.
- Empty `data_array` -> array of zeros; empty `bins_array` -> count of
  all data? (returns `{count}`) — confirm.

## Coercion
- Text/blank/logical in `data_array` ignored; in `bins_array` ignored
  (non-numeric bins skipped) — confirm.

## Examples
- `FREQUENCY({1,2,3,4,5},{2,4})` -> `{2;2;1}` (<=2, <=4, >4)
- `FREQUENCY({79,85,90,97},{80,90,100})` -> `{1;2;1}`
- `FREQUENCY({1,1,1},{1})` -> `{3;0}`
- `FREQUENCY({}, {1,2})` -> `{0;0;0}` — confirm semantics

## Compatibility
- Pre-dynamic-array Excel requires Ctrl+Shift+Enter over n+1 cells;
  Excel 365 spills. Engine: result is an `ArrayValue`; spill support
  per plan §6 Phase 4.

## Open questions
- Unsorted `bins_array` handling.
- Blank `bins_array` result.
- Behavior when `data_array` has zero numerics (zeros array).
