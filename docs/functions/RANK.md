# RANK

`RANK(number, ref, [order])` — rank of `number` within the numeric
values in `ref`; ties share the same (top) rank and leave gaps.

Legacy compatibility function; modern equivalents are `RANK.EQ`
(identical) and `RANK.AVG` (ties get the average rank — different
result).

## Arguments
- `number`: required scalar.
- `ref`: required range/array; non-numeric values ignored; errors
  propagate.
- `order`: optional; `0` or omitted -> **descending** (largest
  value ranks 1); any non-zero value -> **ascending** (smallest
  ranks 1).

## Semantics
- Descending: rank = `1 + count(ref_i > number)`.
- Ascending: rank = `1 + count(ref_i < number)`.
- Equal values get equal ranks; the next distinct value skips
  positions (e.g. ranks `1,2,2,4`).

## Coercion
- `number`: numeric text/booleans coerced -> `#VALUE!` if not.
- `ref` elements: text/booleans/blanks ignored; errors propagate.

## Errors
- `number` not present in `ref` -> `#N/A`.
- Non-numeric `number` -> `#VALUE!`.

## Examples
- `RANK(7, {7,3.5,3.5,1,2}, 1)` -> `5` (Microsoft docs example)
- `RANK(2, {7,3.5,3.5,1,2}, 0)` -> `4` (Microsoft docs example)
- `RANK(3.5, {7,3.5,3.5,1,2}, 0)` -> `2` (tie -> top rank 2; next
  distinct is 4)
- `RANK(6, {1,2,3})` -> `#N/A`

## Open questions
- Floating-point equality when `number` is computed vs stored
  (e.g. `RANK(0.1+0.2, {0.3})`) — fixture.
