# TRANSPOSE

`TRANSPOSE(array)` — swaps rows and columns of an array or range.

## Arguments
- `array`: a single array or range value.

## Behavior
- m x n -> n x m. `TRANSPOSE({1,2;3,4})` -> `[[1,3],[2,4]]`.
- Works on 1xN and Nx1 vectors: column -> row and vice versa.
- Blank cells remain Blank; errors propagate as array elements (the
  element is `#` — the call itself does not collapse to an error; verify
  in fixtures).

## Spill semantics
- Spills into the transposed footprint; `#SPILL!` on collision
  (atomic, nothing written).
- Subject to the same array-cell cap as SEQUENCE; oversize -> limit
  error.

## Errors
- `#VALUE!` for a non-array argument (scalars are returned as 1x1 —
  verify vs Excel which wraps scalars).

## Open questions
- Whether error *elements* inside the input propagate element-wise or
  make the whole call an error (element-wise expected).
- Scalar input handling (1x1 passthrough vs `#VALUE!`).
