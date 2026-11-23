# LOOKUP

`LOOKUP(lookup_value, lookup_vector, [result_vector])` — vector form;
also `LOOKUP(lookup_value, array)` — array form.

v2 plan §2 (051): vector/array forms, approximate-match assumption and
boundaries.

## Arguments
- **Vector form**: `lookup_vector` is one row or one column;
  `result_vector` same size/shape as `lookup_vector`.
- **Array form** (2 args): `array` 2-D; searches the first row if
  wider-than-tall, else first column; returns from the last row/column
  respectively. Square array -> column search (confirm).

## Behavior
- Always approximate: finds the largest `lookup_vector` value
  `<= lookup_value`; assumes ascending order. Unsorted input yields
  binary-search-defined results (same caveat as VLOOKUP TRUE).
- Case-insensitive text comparison; no wildcard support (approximate
  mode — confirm).
- `lookup_value` below all elements -> `#N/A`.

## Errors
- `lookup_vector`/`result_vector` size mismatch -> `#N/A` (Excel) —
  confirm.
- Error `lookup_value` propagates. Errors inside the vector during
  binary search — open.

## Edge cases
- `LOOKUP(2.5, {1;2;3;4}, {"a";"b";"c";"d"})` -> `"b"`.
- Blanks inside `lookup_vector`: Excel may misbehave on unsorted data —
  fixture.
- Array form square case (`LOOKUP(v, A1:B2)`): column orientation —
  confirm.

## Open questions
- Square-array orientation rule.
- Result-vector size-mismatch error code.
- Error elements in vectors: propagate vs skip.
