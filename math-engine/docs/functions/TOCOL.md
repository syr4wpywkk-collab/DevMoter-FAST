# TOCOL

`TOCOL(array, [ignore], [scan_by_column])` — flattens an array into a
single column.

## Arguments
- `ignore`: 0 = keep all (default); 1 = ignore blanks; 2 = ignore
  errors; 3 = ignore blanks and errors.
- `scan_by_column`: FALSE (default) = row-major scan; TRUE = column-
  major.

## Behavior
- `TOCOL({1,2;3,4})` -> `[[1],[2],[3],[4]]`.
- `TOCOL({1,2;3,4},,TRUE)` -> `[[1],[3],[2],[4]]`.
- With `ignore=2`, error elements are removed; otherwise errors are
  carried as elements.

## Errors
- `#VALUE!` for `ignore` outside 0..3.
- If all elements are ignored -> empty result -> `#CALC!` (same empty
  question as TAKE/DROP).

## Spill semantics
- Single-column spill of kept elements; `#SPILL!` on collision; size cap
  applies.

## Open questions
- `ignore` values 1..3 cover blanks/errors; whether "blank" includes
  empty text `""` (Blank vs `Text("")` distinction, plan §3.1).
- Empty-result error kind (`#CALC!` vs alternative).
