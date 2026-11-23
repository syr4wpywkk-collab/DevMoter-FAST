# MONTH

`MONTH(serial_number)` — month (1–12) of a date serial.

v2 plan §2 (070): serial conversion and range validation.

## Arguments
- `serial_number`: numeric scalar, direct coercion (same coercion and
  date-system notes as `YEAR`).

## Behavior
- `MONTH(45000)` -> 4 (2023-04-XX under 1900 system — verify
  fixtures).
- Fraction ignored.
- Same serial-validity rules as `YEAR`: negatives -> `#NUM!`.

## Errors
- Out-of-range serial -> `#NUM!`.
- Non-coercible text -> `#VALUE!`; error inputs propagate.

## Edge cases
- Serial in the fictitious Feb-1900 window (59/60) — which month does
  serial 60 report (expected 2 under the bug-compat mapping — fixture).
- 1904 system parity with `YEAR`/`DAY`.

## Open questions
- Leap-bug preservation (shared with YEAR/DAY).
- Text-date coercion policy.
