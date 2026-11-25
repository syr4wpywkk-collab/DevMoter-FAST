# COUNTA

`COUNTA(value1, [value2], ...)` — counts non-empty values.

## Behavior
- Counts numbers, text (including `""` and `" "`), booleans, and error
  cells. Does not count blank cells.
- `Blank` ≠ `Text("")`: a formula-returned `""` or a literal `""` IS
  counted; an untouched blank cell is NOT (plan §3.1).

## Edge cases
- `COUNTA(A1:A3)` all blank -> 0.
- Direct scalar args are always counted (`COUNTA("x",1,TRUE)` -> 3).
- **SPEC-OPEN** (P1-COUNTA-010): is an error produced inside an argument
  expression counted (like an error cell) or propagated? Verify in Excel.

## Confirm against reference
- The `""` vs blank distinction must be recorded empirically (a cell
  containing `=""` counts in Excel).
