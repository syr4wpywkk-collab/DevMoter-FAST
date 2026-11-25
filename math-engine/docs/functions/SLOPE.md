# SLOPE

`SLOPE(known_ys, known_xs)` — least-squares regression slope
`Σ((x-x̄)(y-ȳ)) / Σ((x-x̄)²)`.

## Arguments
- `known_ys`, `known_xs`: ranges/arrays of equal size; paired
  elementwise in row-major order.
- Pairs are dropped when either side is non-numeric (text, boolean,
  blank); errors propagate.
- Array shapes must match, else `#N/A`.

## Behavior
- Computed over the surviving numeric pairs only.
- `SLOPE({1,2,3},{2,4,6})` -> `0.5`.

## Errors
- `#DIV/0!` when fewer than 2 pairs remain or all x values are equal
  (zero variance in x).
- `#N/A` when `known_ys` and `known_xs` sizes differ.

## Edge cases
- Perfectly collinear data -> exact result within f64 tolerance.
- Numerical stability: use the deviation formula above, not the
  naive `Σxy - n·x̄·ȳ` shortcut, to bound cancellation error.

## Open questions
- Pair-dropping rule for mismatched-position blanks vs Excel (Excel
  requires same-shaped arguments; confirm `#N/A` vs dropping).
