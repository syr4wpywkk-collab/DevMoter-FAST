# ROWS

`ROWS(array)` — returns the number of rows in a reference or array.

v2 plan §2 (055): row count of reference or array.

## Arguments
- `array`: a range reference or array literal (required).

## Behavior
- `ROWS(A1:A10)` -> 10; `ROWS(A1:C10)` -> 10; `ROWS({1,2;3,4})` -> 2.
- Does not evaluate or care about contents — pure shape query;
  errors inside the range do NOT propagate (confirm).

## Errors
- Scalar argument -> `#VALUE!` (confirm; Excel may produce an error or
  treat as 1 — fixture needed).
- Invalid reference -> `#REF!`.

## Edge cases
- `ROWS(A:A)` whole-column — engine does not support full-column refs
  yet (SPEC-OPEN core item).
- Empty array literal `{}` — parser support status open.

## Open questions
- Scalar-input behavior (`ROWS(5)`).
