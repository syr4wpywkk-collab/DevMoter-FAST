# EDATE

`EDATE(start_date, months)` — serial of the date `months` months
before/after `start_date`.

v2 plan §2 (075): end-of-month clamping, leap years, negative months.

## Arguments
- `start_date`: date serial (coerced like `YEAR`'s serial; text-date
  coercion open). Fractional part truncated.
- `months`: integer months; fractional truncated toward zero;
  negative moves backward.

## Behavior
- `EDATE(45000, 1)` -> serial one month later.
- **Day clamping**: Jan-31 + 1 month -> last day of Feb (28 or 29) —
  the day is clamped to the target month's last day, not rolled into
  the next month (Excel behavior).
- `EDATE` result keeps no time component (integer serial).

## Errors
- Result outside the serial domain -> `#NUM!`.
- Non-coercible inputs -> `#VALUE!`.

## Edge cases
- `EDATE(leap_day_2024, 12)` -> 2025-02-28.
- `EDATE(jan31, -1)` -> Dec 31 of prior year.
- `months` = 0 -> same date (normalized serial, fraction dropped).
- `EDATE(serial_60_bug_window, n)` interacts with the 1900 leap bug —
  fixture once the date-system policy is fixed.

## Open questions
- Text start_date coercion (`EDATE("2026-01-15", 1)` — Excel coerces).
- Whether the time-of-day fraction is always dropped (Excel: yes).
