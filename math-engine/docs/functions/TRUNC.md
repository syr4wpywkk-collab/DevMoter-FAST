# TRUNC

`TRUNC(number, [num_digits])` — truncates toward zero to `num_digits`
decimal places.

v2 plan §2 (042): truncate toward zero; supports the digits argument.

## Arguments
- `number`: numeric scalar, direct-argument coercion.
- `num_digits`: optional integer (default 0); fractional values are
  themselves truncated toward zero (Excel behavior).

## Behavior
- `TRUNC(8.9)` -> 8; `TRUNC(-8.9)` -> -8 (differs from `INT`).
- `TRUNC(PI(), 3)` -> 3.141.
- Negative `num_digits` truncates left of the decimal point:
  `TRUNC(1234.567, -2)` -> 1200.
- Implemented as `sign * floor(|x| * 10^d) / 10^d` with care for
  `10^d` overflow when `|d|` is large.

## Errors
- Coercion failures -> `#VALUE!`.
- Error inputs propagate.

## Edge cases
- `TRUNC(x, 0)` for `|x| < 1` -> 0 (normalized, not `-0`).
- Very large `num_digits` (e.g. 100, -100): result equals `x` or `0`
  respectively; no error expected (confirm).
- `TRUNC` on exact integers is a no-op.

## Open questions
- Excel's `num_digits` practical range (it appears unbounded; confirm
  saturation behavior at extreme values).
