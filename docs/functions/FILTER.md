# FILTER

`FILTER(array, include, [if_empty])` — returns the rows (or columns) of `array` whose corresponding `include` element is truthy. Result is a **spilled array**.

## Arguments
- `array`: range or array, any shape.
- `include`: array of booleans/numbers whose length equals `array`'s
  height (row filtering) or width (column filtering).
- `if_empty`: optional value returned when nothing matches; default
  `#CALC!`.

## Result shape & spill semantics
- Row filtering: `include` is a column vector of length `rows(array)`;
  result is `k x cols(array)` where `k` = number of truthy entries.
- Column filtering: `include` is a row vector of length `cols(array)`;
  result is `rows(array) x k`.
- The result spills from the formula cell into a rectangular spill
  range. If **any** cell in the target spill range is non-blank
  (including `""`? — confirm), the function returns `#SPILL!` and no
  cells are written.
- The spill range is reserved while the formula remains; on
  recalculation producing a different size, the old range is released
  before writing the new one (plan §6 Phase 4). Intermediate states
  must never leave stale values.
- Spill extending beyond sheet bounds -> `#SPILL!` (confirm error kind).

## Truthiness of `include`
- Boolean `TRUE`/`FALSE` direct.
- Numbers: nonzero -> keep, zero -> drop (Excel behavior).
- Text (including numeric text) and blank entries -> treated as no
  match? Excel returns `#VALUE!` for text in `include` — **SPEC-OPEN**:
  whether text entries are `#VALUE!` or treated as FALSE.
- Error entries in `include` propagate.

## Errors
- `include` length mismatch with `array` dimension -> `#VALUE!`.
- `include` neither a row nor column vector matching `array` -> `#VALUE!`.
- Empty result without `if_empty` -> `#CALC!`.
- Blocked spill -> `#SPILL!`; obstruction is reported, nothing written.
- Errors inside `array` propagate to output cells unchanged.

## Edge cases
- `k = 0` -> `if_empty` or `#CALC!`.
- `if_empty` may be an array/scalar; under spill it spills (Excel).
- Single-row or single-column `array`.
- Filtering preserves original row/column order (stable).

## Open questions
- Text entries in `include`: error vs falsy.
- `""` cells as spill obstructions (Excel treats them as occupied).
- `if_empty` returning multi-cell results — supported once spill exists.
- Whether `include` may be 2-D (Excel: only if one dimension is 1).
