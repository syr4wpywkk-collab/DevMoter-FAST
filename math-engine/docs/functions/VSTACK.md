# VSTACK

`VSTACK(array1, [array2], ...)` — stacks arrays vertically (adds rows).

## Arguments
- 1..255 arrays, ranges, or scalars (scalars treated as 1x1).

## Behavior
- Concatenates row-wise in argument order.
- Column counts may differ: the result width is the max; missing cells
  are padded with `#N/A` (Excel behavior, plan §2 note 093).
- `VSTACK({1,2},{3})` -> `[[1,2],[3,#N/A]]`.

## Spill semantics
- Result rows = sum of input rows; spills atomically; `#SPILL!` on
  collision; total cells bounded by the array-size cap.

## Errors
- `#N/A` padding cells are data, not call failures — they propagate
  normally if consumed.
- Error values inside inputs are carried element-wise into the result.

## Edge cases
- Single argument -> that array (padded to itself: no-op).
- All-scalar args -> n x 1 column.

## Open questions
- Whether padding is `#N/A` or Blank — Excel uses `#N/A`; confirm and
  record whether an opt-out flag is needed.
