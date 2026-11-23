# TOROW

`TOROW(array, [ignore], [scan_by_column])` — flattens an array into a
single row.

## Arguments
- Identical to TOCOL: `ignore` 0..3, `scan_by_column` flag.

## Behavior
- `TOROW({1,2;3,4})` -> `[[1,2,3,4]]`.
- Same scanning and ignore semantics as TOCOL, transposed output.

## Errors
- `#VALUE!` for bad `ignore`; `#CALC!` if result is empty
  (same open question).

## Spill semantics
- Single-row spill; `#SPILL!` on collision; size cap applies.

## Open questions
- Same as TOCOL.
