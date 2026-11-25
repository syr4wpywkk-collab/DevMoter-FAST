# AREAS

`AREAS(reference)` — returns the number of contiguous areas in a
reference.

## Arguments
- `reference`: required; a reference value (cell, range, union of
  ranges, or a named range resolving to one). Union syntax:
  `AREAS((A1:B2,C3:D4))` — the extra parentheses are required in Excel
  because the argument separator `,` is also the union operator.

## Semantics
- Returns `Number`: `1` for a single cell or single contiguous range,
  `n` for a union of `n` areas.
- Non-reference arguments (numbers, text) -> `#VALUE!` in Excel (a type
  error; confirm).
- Overlapping ranges passed as a union still count as their listed
  area count — Excel counts areas in the union expression, not merged
  geometry (confirm: `(A1:B2,B2:C3)` -> 2).

## Coercion
- No coercion: requires a true reference; `AREAS("A1:B2")` is a type
  error — the text is not parsed as a reference (use `INDIRECT`).

## Errors
- `#REF!` inside the reference propagates.
- Non-reference argument -> `#VALUE!` (confirm exact error; some
  versions report an argument-type error).

## Examples
- `AREAS(B2:D4)` -> `1`
- `AREAS((B2:D4,E5,F6:I9))` -> `3`
- `AREAS((A1,B1:A2))` -> `2` (overlapping still counts as two areas —
  confirm against reference)

## Engine requirements
- Requires reference values (not just evaluated scalars) to be passed
  into the function — the evaluator must preserve `RangeRef` operands as
  first-class reference values and support the union operator.

## Open questions
- Whether an intersection (`A1:B2 A2:C3`) counts as 1 area (expected).
- Error code for non-reference input: `#VALUE!` vs a parse-time failure.
- Counting of duplicate/overlapping areas in unions.
