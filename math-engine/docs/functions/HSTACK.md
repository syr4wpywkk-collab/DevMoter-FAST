# HSTACK

`HSTACK(array1, [array2], ...)` — stacks arrays horizontally
(adds columns).

## Arguments
- 1..255 arrays, ranges, or scalars.

## Behavior
- Concatenates column-wise in argument order.
- Row counts may differ: result height is the max; missing cells padded
  with `#N/A` (plan §2 note 094).
- `HSTACK({1;2},{3,4})` -> `[[1,3,4],[2,#N/A,#N/A]]`.

## Spill semantics
- Result columns = sum of input columns; atomic spill; `#SPILL!` on
  collision; size cap applies.

## Errors
- Same as VSTACK: `#N/A` is padding data; input errors carry through
  element-wise.

## Edge cases
- Single argument -> same array.
- Scalars form a 1 x n row.

## Open questions
- Same padding question as VSTACK.
