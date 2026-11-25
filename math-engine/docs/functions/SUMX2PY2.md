# SUMX2PY2

`SUMX2PY2(array_x, array_y)` — returns SUM((x_i)^2 + (y_i)^2) over
paired arrays.

## Arguments
- `array_x`, `array_y`: required ranges/arrays with the same number
  of elements.

## Behavior
- `SUMX2PY2({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})` -> 521 (documented
  Microsoft example).
- Pairwise numeric rule identical to `SUMX2MY2`.

## Errors
- Different element counts -> `#N/A`.
- Coercion failures -> `#VALUE!`; error cells propagate.
- Overflow -> `#NUM!`.

## Open questions
- Same open items as `SUMX2MY2` (pairwise skip, shape vs count).
