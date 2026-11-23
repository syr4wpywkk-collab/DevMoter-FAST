# INDEX

`INDEX(array, row_num, [column_num])` — returns the value at a position.

Plan §6: **array form only** for the initial subset. The reference form
`INDEX((A1:B2,C1:D2), row, col, area_num)` is out of scope until
compatibility is confirmed.

## Arguments
- `array`: range or array (any shape).
- `row_num`: 1-based position; coerced like a numeric scalar
  (fractional values are truncated toward zero — Excel behavior).
- `column_num`: optional; required when `array` is two-dimensional,
  unless the caller wants the whole row (dynamic-array engines) —
  **SPEC-OPEN** for this engine which has no spill yet.

## Behavior
- `INDEX(A1:A3,2)` on a column vector uses `row_num`.
- `INDEX(A1:C1,2)` on a row vector treats `row_num` as the column index
  (single-dimension vectors accept one index).
- `INDEX(A1:B2,2,1)` on a 2-D range -> row 2, column 1.
- `row_num`/`column_num` of `0` select the *entire* column/row in Excel
  (returns an array). **SPEC-OPEN** here until dynamic arrays land
  (plan §6 Phase 4); may return `#VALUE!` meanwhile.
- Omitting `column_num` on a 2-D range returns the whole `row_num` row
  in Excel — **SPEC-OPEN** (array result; pending spill support).

## Type coercion
- Numeric text for indices coerces (`"2"` -> 2; confirm).
- Boolean index coerces TRUE->1/FALSE->0 (confirm).
- Blank referenced cell as index -> 0 -> array-select semantics (open).
- Returning an error cell propagates that error.

## Errors
- `row_num`/`column_num` out of bounds or negative -> `#REF!`.
- Non-coercible index -> `#VALUE!`.
- Reference form (multi-area) -> unsupported error for now.

## Edge cases
- Fractional index `INDEX(A1:A3,1.9)` -> element 1 (truncation).
- `INDEX` over a range containing blanks returns blank
  (`{"blank":true}`).

## Confirm against reference
- `0` / omitted-index array semantics under a non-spill engine.
- Coercion of text/boolean/blank indices.
