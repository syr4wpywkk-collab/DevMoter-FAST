# DATE

`DATE(year, month, day)` — the serial number for the given calendar date, with Excel-style normalization of out-of-range arguments.

## Arguments
- `year`, `month`, `day`: required; each coerced per direct-scalar
  rules and **truncated toward zero** to an integer.

## Normalization (Excel-compatible)
- `month` outside `1..12` rolls over years: `DATE(2024,13,1)` =
  2025-01-01; `DATE(2024,0,1)` = 2023-12-01.
- `day` outside `1..days_in_month` rolls similarly: `DATE(2024,1,32)` =
  2024-02-01; `DATE(2024,1,0)` = 2023-12-31.
- `year` handling (1900 system): `0..1899` is offset by 1900
  (`DATE(24,1,1)` = 1924-01-01); `1900..9999` used as-is; negative or
  `>= 10000` -> `#NUM!`. (Excel rule — verify boundary 1899/1900.)
- Normalization happens **before** range validation: `DATE(2024,-1,1)`
  rolls to 2022, not an error.

## Date systems & serials
- Workbook-scoped 1900/1904 system (plan §3.1). Under 1904 the same
  calendar date is 1462 lower than under 1900.
- **1900 leap-year bug compatibility:** Excel treats 1900 as a leap
  year; serial 60 is the fictitious 1900-02-29. To stay compatible
  this engine must map dates >= 1900-03-01 to serials one higher than
  a proleptic-Gregorian count (matching Excel exactly), and must
  decide how `DATE(1900,2,29)`/`DATE(1900,2,30)` normalize —
  **SPEC-OPEN** whether serial 60 is a representable, accepted output
  (expected: yes for file compatibility; document round-trip rules).
- Earliest serial: `DATE(1900,1,0)` gives serial 0 (displayed as
  1900-01-00 in Excel — confirm display policy).

## Errors
- Resulting date before the system epoch or beyond 9999-12-31 ->
  `#NUM!`.
- Negative `year` after the 0..1899 offset rule, or `year >= 10000` ->
  `#NUM!`.
- Coercion failures -> `#VALUE!`; errors propagate.

## Edge cases
- `DATE(2024,2,29)` vs `DATE(2023,2,29)` (latter rolls to Mar 1? — no:
  Excel normalizes Feb 29 in a non-leap year to Mar 1? **Confirm** —
  actually `DATE(2023,2,29)` = 2023-03-01 serial in Excel? Open
  question; Excel yields 2023-03-01).
- `month`/`day` of very large magnitude (e.g. `DATE(2024,12000,1)`) —
  must not overflow; saturating arithmetic then `#NUM!`.
- Fractional args truncate: `DATE(2024.9,6.9,15.9)` = `DATE(2024,6,15)`.

## Open questions
- Exact `year` window rule (0..1899 offset vs <1900 error in 1904
  system — Excel uses 4..1899 offset under 1904; confirm).
- Serial-60 acceptance and round-trip behavior.
- Non-leap Feb 29 normalization.
