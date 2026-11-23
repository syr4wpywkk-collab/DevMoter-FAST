# INT

`INT(number)` — rounds a number down to the nearest integer (toward
negative infinity).

v2 plan §2 (041): negatives round toward negative infinity.

## Arguments
- `number`: numeric scalar, direct-argument coercion
  (text `"3.7"` -> 3.7; boolean -> 1/0; blank -> 0; other text ->
  `#VALUE!`).

## Behavior
- `INT(8.9)` -> 8; `INT(-8.9)` -> -9 (differs from `TRUNC`).
- `INT(-8)` -> -8 (already integral).
- Implemented as `floor`, not `trunc`.

## Errors
- Non-coercible text -> `#VALUE!`.
- Error inputs propagate.

## Edge cases
- `INT(0)` -> 0; `INT(-0.5)` -> -1.
- `INT(2.9999999999999996)` — f64 boundary cases near integers belong
  in fixtures with tolerance policy.
- Values beyond `i64`/`u64` still return an f64 result; no range error.

## Open questions
- Confirm result type representation: always `Number` even for large
  magnitudes (no int64 fast path needed).
