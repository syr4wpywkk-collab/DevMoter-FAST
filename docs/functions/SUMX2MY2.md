# SUMX2MY2

`SUMX2MY2(array_x, array_y)` — returns SUM((x_i)^2 - (y_i)^2) over
paired arrays.

## Arguments
- `array_x`, `array_y`: required ranges/arrays with the same number
  of elements.

## Behavior
- `SUMX2MY2({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})` -> -55 (documented
  Microsoft example).
- Iterates elementwise over paired positions; only positions where
  BOTH elements are numeric contribute (Excel: "arguments that are
  numbers, or names/arrays/references containing numbers" — pairs
  containing text/blank/logical are skipped for that position —
  confirm precise rule).

## Errors
- Different element counts -> `#N/A`.
- Non-numeric coercion on direct scalar args -> `#VALUE!`; error
  cells propagate.

## Edge cases
- Same total count but different *shape* (e.g. 1x6 vs 6x1): Excel
  compares element counts, not shape — confirm.

## Open questions
- Pairwise skip rule when only one side is numeric.
- Shape-mismatch-same-count acceptance.
