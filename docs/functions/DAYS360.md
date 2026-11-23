# DAYS360

`DAYS360(start_date, end_date, [method])` — days between dates on a
360-day year (30-day months).

## Arguments
- `start_date`, `end_date`: required date serials (or text dates per
  Excel coercion).
- `method`: optional, default `FALSE`; `FALSE`/omitted = **US
  (NASD)** convention, `TRUE` = **European** convention.

## Semantics
- `DAYS360 = 360*(y2-y1) + 30*(m2-m1) + (d2'-d1')` with adjusted
  day numbers:
  - **US/NASD**: if `d1` = 31 -> 30. If `d2` = 31 -> 30 when `d1` is
    30 or 31, else stays 31. If start is last day of February ->
    `d1` = 30; if end is last day of February AND start is last day
    of February -> `d2` = 30 (NASD Feb rules — transcribe exact:
    start=last-Feb-day -> 30; end=last-Feb-day -> 30 if start's
    day>=30? confirm exact NASD condition).
  - **European**: `d` = 31 -> 30 for both dates (no special Feb
    rule beyond that; last day of Feb stays 28/29? European method:
    Feb 28 -> 28; the 30-day cap only applies to 31st — confirm).
- Negative results allowed (start > end).

## Coercion
- Text dates parsed per `DATEVALUE` rules; numbers as serials;
  truncation of fractional serials (confirm).

## Errors
- Unparseable text -> `#VALUE!`.
- Out-of-domain serials -> `#NUM!`.

## Examples
- `DAYS360(44197, 45292)` (2021-01-01 -> 2023-12-31) US -> `1079`
  (360*2 + 30*11 + 29 = 1079).
- `DAYS360(44197, 45292, TRUE)` -> `1079`? European d2 31->30 -> 1078.
  Verify both fixtures.
- `DAYS360(45000, 45000)` -> `0`.
- `DAYS360(45000, 44900)` -> `-100`.
- Excel doc example: `DAYS360(DATE(2008,1,30), DATE(2008,2,1))` ->
  `1`.

## Open questions
- Exact NASD February condition ordering.
- Whether negative results flow through (expected yes).
- `method` truthiness of non-boolean values (any nonzero -> TRUE?).
