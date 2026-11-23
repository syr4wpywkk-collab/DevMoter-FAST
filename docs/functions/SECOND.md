# SECOND

`SECOND(serial_number)` — second (0–59) of a time serial.

v2 plan §2 (074): second component of a fractional day.

## Arguments
- `serial_number`: numeric scalar, direct coercion; fractional part
  only.

## Behavior
- `SECOND(TIME(15,45,30))` -> 30; `SECOND(0.5)` -> 0.
- Excel returns an integer 0–59 — fractional seconds are truncated,
  not rounded (confirm).

## Errors
- Negative serial -> `#NUM!` (confirm).
- Non-coercible text -> `#VALUE!`.

## Edge cases
- Fractional seconds (`TIME(0,0,30.9)` -> 30 — confirm truncation).
- Boundary carry into next minute (59.9999 -> 59 vs 60/0).

## Open questions
- Fractional-second truncation vs rounding.
- Shared epsilon helper with HOUR/MINUTE.
