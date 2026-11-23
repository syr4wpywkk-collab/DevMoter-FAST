# HOUR

`HOUR(serial_number)` — hour (0–23) of a time serial.

v2 plan §2 (072): hour component of a fractional day.

## Arguments
- `serial_number`: numeric scalar, direct coercion; only the
  fractional part matters (date part ignored).

## Behavior
- `HOUR(0.5)` -> 12; `HOUR(TIME(15,30,0))` -> 15.
- Serials >= 1: `HOUR(45000.75)` -> 18.
- Serial computed as `floor((serial mod 1) * 24)` with float-tolerance
  care at boundaries (0.9999999 day).

## Errors
- Negative serial -> `#NUM!` (confirm; Excel errors for < 0).
- Non-coercible text -> `#VALUE!`.

## Edge cases
- Fraction landing exactly on an hour boundary with f64 error —
  round the day-fraction to a small epsilon before extracting
  (shared `time_components` helper for HOUR/MINUTE/SECOND).
- Serial 0.9999999 -> 23 vs 24 roll — fixture.

## Open questions
- Epsilon policy for boundary rounding (shared across H/M/S).
- Negative-fractional serials (e.g. -0.5).
