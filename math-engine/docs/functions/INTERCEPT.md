# INTERCEPT

`INTERCEPT(known_ys, known_xs)` — regression intercept `ȳ - b·x̄`
where `b` is the SLOPE.

## Arguments
- Same argument and pair-dropping rules as SLOPE.

## Behavior
- `INTERCEPT({1,2,3},{2,4,6})` -> `0`.
- Computed from the same surviving numeric pairs as SLOPE.

## Errors
- `#DIV/0!` when fewer than 2 pairs or zero x-variance.
- `#N/A` on size mismatch.

## Edge cases
- Vertical data (all x equal) -> `#DIV/0!`, not infinity.

## Open questions
- None beyond SLOPE's pair-matching question.
