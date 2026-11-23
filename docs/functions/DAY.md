# DAY

`DAY(serial_number)` — day of month (1–31) of a date serial.

v2 plan §2 (071): serial conversion and range validation.

## Arguments
- `serial_number`: numeric scalar, direct coercion (same notes as
  `YEAR`/`MONTH`).

## Behavior
- `DAY(45000)` -> day component under the active date system.
- Fraction ignored; negatives -> `#NUM!`.

## Errors
- Out-of-range serial -> `#NUM!`.
- Non-coercible text -> `#VALUE!`.

## Edge cases
- Serial 60 (fictitious 1900-02-29) -> 29 under bug-compat; decide
  policy and fixture it.
- Serial 0 -> day 0 semantics (Excel reports the "0th" of January
  quirk — confirm what it actually returns).

## Open questions
- Leap-bug and serial-0 behavior; shared date_serial helper policy in
  `common/date_serial.rs`.
