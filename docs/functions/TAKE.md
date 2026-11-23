# TAKE

`TAKE(array, rows, [columns])` — returns a contiguous slice from the
start or end of an array.

## Arguments
- `rows`: positive -> first `rows` rows; negative -> last `|rows|` rows;
  must not exceed array height.
- `columns`: optional, same rule applied to columns; omitted -> all
  columns.
- `0` is allowed -> returns an empty array in that dimension
  (behavior fixed in Edge cases).

## Behavior
- `TAKE({1,2;3,4;5,6},2)` -> `[[1,2],[3,4]]`.
- `TAKE({1,2;3,4;5,6},-1)` -> `[[5,6]]`.
- `TAKE(A1:C3, ,2)` takes 2 columns.

## Errors
- `#CALC!` when `|rows|` > height or `|columns|` > width (Excel uses
  `#CALC!` "empty array" semantics for some cases — see open question).
- `#VALUE!` for non-numeric size args.

## Edge cases
- `rows = 0` or `columns = 0` -> Excel returns `#CALC!` (empty arrays
  are not legal values). Decide whether the engine returns `#CALC!` too
  or supports empty arrays internally.

## Spill semantics
- Result spills; `#SPILL!` on collision; within the size cap.

## Open questions
- Exact error for over-take and zero sizes (`#CALC!` vs `#VALUE!` vs
  engine-specific), and whether empty arrays are representable
  (plan §3.1 requires empty-array semantics to be defined).
