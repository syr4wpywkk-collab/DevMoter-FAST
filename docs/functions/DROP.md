# DROP

`DROP(array, rows, [columns])` — removes rows/columns from the start
or end of an array; complement of TAKE.

## Arguments
- `rows`: positive -> drop first `rows` rows; negative -> drop last
  `|rows|` rows.
- `columns`: optional, same for columns; omitted -> none dropped.

## Behavior
- `DROP({1,2;3,4;5,6},1)` -> `[[3,4],[5,6]]`.
- `DROP({1,2;3,4;5,6},-2)` -> `[[1,2]]`.
- `DROP(A1:C3,,1)` drops the first column.

## Errors
- `#CALC!` when everything is dropped (empty result) — same empty-array
  question as TAKE.
- `#VALUE!` for non-numeric sizes.

## Edge cases
- Dropping exactly all rows (`rows` = height) -> empty -> `#CALC!`
  (pending open question).
- `rows = 0, columns = 0` -> `array` unchanged.

## Spill semantics
- Result spills; `#SPILL!` on collision; within size cap.

## Open questions
- Same as TAKE: empty-array representability and the chosen error kind.
