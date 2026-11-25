# YEAR

`YEAR(serial_number)` — year of a date serial, 1900–9999.

v2 plan §2 (069): 1900/1904 date systems and serial conversion.

## Arguments
- `serial_number`: numeric scalar (direct coercion — numeric text like
  `"45000"` coerces; date-formatted text coercion is open) or a
  date-valued cell.

## Behavior
- Uses the workbook date system: 1900 system (serial 1 = 1900-01-01,
  includes Excel's fictitious 1900-02-29 for compat — confirm engine
  keeps the bug) or 1904 system (serial 0 = 1904-01-01).
- Fractional serials: fraction ignored.
- `YEAR(45000)` -> 2023 (1900 system).

## Errors
- Serial < 0 or > system max (2958465-ish for 1900 system) -> `#NUM!`
  (Excel errors on negatives; confirm upper bound).
- Non-coercible text -> `#VALUE!`.

## Edge cases
- Serial 0 -> 1900 (the fictitious Jan 0 / 1900-01-00 quirk — fixture).
- Serials 1–60 under the 1900 leap-bug mapping.
- 1904 system shifts results by 4 years for the same serial.

## Open questions
- Whether the engine preserves the 1900-02-29 leap bug.
- Serial upper bound / far-future behavior.
- Text-date coercion (`YEAR("2026-01-01")` — Excel coerces; engine
  policy open).
