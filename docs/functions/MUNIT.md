# MUNIT

`MUNIT(dimension)` — returns the n x n identity (unit) matrix.

## Arguments
- `dimension`: required positive integer scalar. Non-integers are
  truncated toward zero.

## Behavior
- `MUNIT(3)` -> `{1,0,0;0,1,0;0,0,1}`.
- `MUNIT(1)` -> `{1}`.
- `MUNIT(2.7)` -> 2x2 identity (truncate — confirm; alternative
  `#VALUE!` on non-integer).

## Errors
- `dimension` <= 0 -> `#VALUE!`.
- Non-numeric text -> `#VALUE!`; errors propagate.
- Dimension exceeding the engine array-size cap -> `#VALUE!` or
  `#NUM!` (cap per plan §10.4).

## Compatibility
- Introduced in Excel 2013; dynamic-array spill in Excel 365.

## Open questions
- Whether non-integer `dimension` truncates or errors.
