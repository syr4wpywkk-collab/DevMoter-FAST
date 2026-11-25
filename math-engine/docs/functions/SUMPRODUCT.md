# SUMPRODUCT

`SUMPRODUCT(array1, [array2], ...)` — multiplies corresponding elements
of equal-shaped arrays and sums the products.

v2 plan §2 (048): same-shape validation, element-wise multiply and sum,
type conversion.

## Arguments
- 1..255 array arguments; each a range or array literal.
- All arrays must have identical shape (rows x cols). Mismatch ->
  `#VALUE!`.

## Behavior
- Result = `sum over i of prod over j of array_j[i]`.
- Single-argument form sums the elements (`SUMPRODUCT(A1:A3)` ==
  `SUM(A1:A3)` semantics for numerics).

## Type coercion
- Elements are coerced per the *range* model: non-numeric entries
  (text, boolean, blank) are treated as `0` — NOT ignored pairwise
  (Excel behavior: `SUMPRODUCT` treats non-numeric array entries as 0).
- Error elements propagate.
- Array literals: `"3"` inside `{...}` — Excel treats text in literal
  arrays as 0 too; confirm.

## Errors
- Shape mismatch -> `#VALUE!`.
- Any error element -> propagates.
- Zero arguments -> `#VALUE!` (arity enforced by parser/registry).

## Edge cases
- `SUMPRODUCT({1;2;3},{4;5;6})` -> 32.
- Blank cell in a range counts as 0 for that element's product.
- Boolean array `SUMPRODUCT(--(A1:A3>2))` idiom relies on `--` coercion;
  raw booleans without `--` count as 0 (Excel) — confirm.
- Very large arrays: bound by array-size limit (see `docs/SPEC-OPEN.md`
  core item on array-limit error type).

## Open questions
- Confirm non-numeric -> 0 (not skip) vs pairwise-skip in the reference
  implementation for ragged real-world fixtures.
- Do 1xN and Nx1 arrays of the same length count as same shape?
  (Excel: `SUMPRODUCT(A1:A3, B1:D1)` -> `#VALUE!`.)
