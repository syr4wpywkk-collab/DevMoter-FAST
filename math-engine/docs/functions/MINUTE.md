# MINUTE

`MINUTE(serial_number)` — minute (0–59) of a time serial.

v2 plan §2 (073): minute component of a fractional day.

## Arguments
- `serial_number`: numeric scalar, direct coercion; fractional part
  only (see `HOUR`).

## Behavior
- `MINUTE(0.5)` -> 0; `MINUTE(TIME(15,45,30))` -> 45.
- Extraction after hours are removed; same boundary-tolerance helper
  as `HOUR`.

## Errors
- Negative serial -> `#NUM!` (confirm).
- Non-coercible text -> `#VALUE!`.

## Edge cases
- 23:59:59.999+ fractions rounding up into the next minute/hour —
  fixture the epsilon.
- Serials >= 1 handled identically to `HOUR`.

## Open questions
- Shared epsilon policy with HOUR/SECOND.
