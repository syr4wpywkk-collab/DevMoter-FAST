# MINVERSE

`MINVERSE(array)` — returns the multiplicative inverse of a square
numeric matrix.

## Arguments
- `array`: required square range or array constant.

## Behavior
- Returns an n x n array; in legacy Excel it was entered with
  Ctrl+Shift+Enter — here it returns an `ArrayValue` and spills where
  spill exists.
- `MINVERSE({4,-1;2,0})` -> `{0,0.5;-1,2}`.
- `MINVERSE({1,2,1;3,4,-1;0,2,3})` -> verify against fixture.
- `MINVERSE({2})` -> `0.5`.

## Errors
- Non-square array -> `#VALUE!`.
- Blank/text/non-coercible elements -> `#VALUE!`.
- Singular matrix (determinant 0) -> `#NUM!`.
- Error elements propagate.

## Edge cases
- Accuracy: Excel computes inverses to ~16 significant digits;
  near-singular input produces large, inaccurate values rather than
  `#NUM!` — document a singularity tolerance threshold as
  **SPEC-OPEN**.

## Open questions
- Pivot threshold below which a matrix is treated as singular.
- Behavior of `MINVERSE` on `ArrayValue` without spill support
  (return array only; `#SPILL!` semantics per plan Phase 4).
